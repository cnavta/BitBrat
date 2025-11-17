# Technical Architecture — CDKTF Network and Load Balancer (BitBrat)

Sprint: sprint-6-d7e4b0
Date: 2025-11-11
Author: Cloud Architect
Source of Truth: architecture.yaml

## 1. Purpose & Scope
This document specifies the technical approach for provisioning the core GCP network and edge ingress for BitBrat using CDK for Terraform (CDKTF):
- Network stack: VPC, subnets, Cloud Router, Cloud NAT, baseline firewall
- Load balancer stack: Global external managed HTTPS Load Balancer, advanced URL Map (YAML-first), backends (Cloud Run serverless NEGs), SSL certificates, logging, and optional Cloud Armor/CDN

The design is environment-aware (dev/staging/prod) and uses architecture.yaml as canonical input for domains, routes, and service backends. The implementation will be introduced in a subsequent sprint; this document defines boundaries, inputs/outputs, and orchestration.

## 2. Design Principles
- Canonical config: architecture.yaml is the single source of truth for services, domains, paths, and defaults
- Programmatic composition: Prefer CDKTF for topology generation and reusability; synthesize to Terraform and apply via brat CLI
- Advanced URL Map: Use YAML-first configuration and import via gcloud to unlock features beyond provider coverage
- Idempotency & drift control: Use describe/diff before imports; use Terraform lifecycle ignore_changes for URL maps managed via YAML
- Security-first: HTTPS by default, least-privilege firewall, optional Cloud Armor policies, logging enabled
- Separation of concerns: Two stacks — network and lb — with well-defined inputs/outputs

## 3. Proposed Repository Structure (incremental)
```
infrastructure/
  cdktf/
    network/
      main.ts           # CDKTF app for VPC, subnets, router, NAT, firewall
      config.ts         # Inputs derived from architecture.yaml/env overlays
      outputs.ts        # Export subnet selfLinks, router names, etc.
    lb/
      main.ts           # CDKTF app for LB scaffolding (certs, proxy, forwarding, NEGs)
      url-maps/
        dev/url-map.yaml
        staging/url-map.yaml
        prod/url-map.yaml
      config.ts         # Inputs from architecture.yaml (domains, routes)
      outputs.ts        # IP addresses, URL map name, cert IDs
```
Orchestrated by brat: `brat infra plan|apply network`, `brat infra plan|apply lb`.

## 4. Network Stack (CDKTF) — Design
### 4.1 Resources
- VPC: Custom mode VPC, flow logs optional
- Subnets: One or more regional subnets per environment; Private Google Access enabled
- Cloud Router: One per region used; named `<vpc>-router-<region>`
- Cloud NAT: One per router; auto-allocate ephemeral external IPs, or static if required
- Firewall baseline:
  - allow-internal: allow tcp/udp/icmp within CIDR ranges
  - allow-health-checks: allow TCP from Google health check ranges (35.191.0.0/16, 130.211.0.0/22) to backends if VM/IAP used (not required for serverless NEGs but safe baseline)
  - deny-all-else (implicit); no 0.0.0.0/0 SSH/RDP; prefer IAP or jump host if ever needed
- Optional: Secondary ranges (for GKE), VPC-SC not in scope yet

### 4.2 Inputs (network/config.ts)
- projectId (string)
- environment ("dev"|"staging"|"prod")
- regions (string[]) — e.g., ["us-central1"]
- cidrBlocks: map of region -> CIDR, e.g., { "us-central1": "10.10.0.0/20" }
- subnets: optional detailed structure per region with names/sizes
- enableFlowLogs (boolean)

### 4.3 Outputs (network/outputs.ts)
- vpcSelfLink
- subnetSelfLinks: map region->subnet selfLink
- routers: map region->router name
- nats: map region->nat name

### 4.4 Serverless VPC Access & Service Placement
- Policy: All BitBrat services must run with VPC egress via Serverless VPC Access Connectors. Each Cloud Run service will be configured with a connector in its region, attaching to the subnet created in this stack.
- The external HTTPS Load Balancer does not require the VPC to reach Cloud Run backends, but the VPC is required for private egress (databases, NATS, partner APIs over VPN), egress controls, and future perimeterization.
- Enforcement:
  - During deployment, brat will perform preflight checks: verify VPC, subnet, Cloud Router/NAT, and a Serverless VPC Connector exist for the target region and environment. If missing, deployment fails with a clear error unless an explicit `--allow-no-vpc` override is set (intended only for sandbox/dev).
  - CI defaults to strict mode (no override), preventing accidental public-only deployments.
- Sizing: Connector minimum CIDR /28; size per expected concurrent connections. Defaults per environment will be documented in env/<env>/network.yaml.
- APIs: Requires enabling Serverless VPC Access API (vpcaccess.googleapis.com).

## 5. Load Balancer Stack (CDKTF) — Design
We will deploy a Global External Managed HTTP(S) Load Balancer with Cloud Run backends via serverless NEGs.

### 5.1 Resources
- IP address: Global external static IP for frontend
- SSL certificates: Google Managed Certificates per domain set (SAN list from architecture.yaml)
- Target HTTPS Proxy: references the managed cert and the URL map
- Forwarding Rule: global TCP/443 to target HTTPS proxy
- URL Map: Advanced configuration supplied via YAML-first import
- Backends: Serverless NEGs (per region, per service), Backend Services referencing NEGs
- Optional: Cloud Armor policy, CDN cache policy, logging

### 5.2 Mapping Architecture to Backends
- For each public service in architecture.yaml with Cloud Run deployment:
  - Create a serverless NEG of type Cloud Run in that service's region: name: `neg-<service>-<region>`
  - Create a backend service: `be-<service>`; attach NEG(s) with capacityScaler=1.0
  - Health checks are managed implicitly for serverless NEGs
- For regional high-availability, attach multiple NEGs (different regions) to the same backend service. Traffic steering can be done in URL map via `routeAction.weightedBackendServices` or default LB balancing.

### 5.3 URL Map Strategy — YAML-First
Because advanced features (route rules, header-based routing, URL rewrites, redirects, weighted backends, fault injection for canaries) are not fully covered by Terraform/CDKTF, we will:
1) Create a minimal URL map via Terraform (name only) so the resource exists under state
2) Immediately import the advanced YAML definition using `gcloud compute url-maps import <name> --global --source=<file>`
3) Add Terraform lifecycle `ignore_changes` on fields the provider cannot round-trip
4) Before import, perform a diff by fetching the current URL map (`gcloud compute url-maps describe`) and comparing to the desired YAML to avoid unnecessary updates in CI

YAML files will be stored under `infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml` and generated from architecture.yaml by brat in a future sprint. During early phases, we may hand-author them with comments indicating canonical mapping.

### 5.4 Example URL Map YAML (Conceptual)
```yaml
name: bitbrat-global-url-map
defaultService: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-default
hostRules:
  - hosts: ["api.example.com"]
    pathMatcher: api-matcher
  - hosts: ["app.example.com"]
    pathMatcher: app-matcher
pathMatchers:
  - name: api-matcher
    defaultService: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-api
    routeRules:
      - priority: 1
        matchRules:
          - prefixMatch: "/v1/"
        routeAction:
          urlRewrite:
            pathPrefixRewrite: "/"
          weightedBackendServices:
            - backendService: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-api
              weight: 90
            - backendService: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-api-canary
              weight: 10
      - priority: 2
        matchRules:
          - prefixMatch: "/v1/oauth/"
            headerMatches:
              - headerName: "x-tenant"
                exactMatch: "gold"
        routeAction:
          urlRewrite:
            pathPrefixRewrite: "/oauth/"
          timeout: 30s
  - name: app-matcher
    defaultService: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-app
```
Notes:
- `${PROJECT}` substituted during generation
- `routeRules` enable advanced matching, header conditions, rewrites, weighted backends

### 5.5 Certificates & DNS
- Managed certs: `google_compute_managed_ssl_certificate` with domains from architecture.yaml
- DNS: Cloud DNS A record points to the global IP of the forwarding rule. Certificates require DNS ownership; provisioning is asynchronous.

### 5.6 Logging and Security
- Enable logging on backend services
- Optional Cloud Armor policy attached to target HTTPS proxy or backend service as required
- Enforce HTTPS-only; add HTTP-to-HTTPS redirect via separate HTTP proxy+forwarding rule if needed

### 5.7 Frontend IP and Certificate Reuse/Import
We support two modes for both the global static IP and TLS certificate:
- Create mode (default for non-prod): CDKTF/Terraform creates a new global external static IP and Google-managed SSL certificate (SANs from architecture.yaml).
- Use-existing mode (recommended for prod): brat/CDKTF wires the load balancer to pre-provisioned resources without attempting to create them.

Implementation approach:
- Static IP:
  - When use-existing is selected, resolve the IP by name via `data.google_compute_global_address` and reference its self_link in the forwarding rule. No Terraform resource is created.
  - When create is selected, manage `google_compute_global_address` and output its address/name.
- Certificates:
  - When use-existing is selected, accept an existing Compute Managed SSL cert resource name or a Certificate Manager certificate map. Attach it to the Target HTTPS Proxy via data references.
  - When create is selected, manage `google_compute_managed_ssl_certificate` with SANs sourced from architecture.yaml.
- Import parity: If desired, we can import existing resources into state, but the default posture is data-sourcing to avoid taking ownership unexpectedly.

Policy:
- Production defaults to use-existing for both IP and cert; dev/staging may create by default.
- Preflight checks will verify that the specified existing IP and cert exist and that the cert status is ACTIVE before cutover; otherwise fail safely.

## 6. Inputs/Outputs for the LB Stack
### Inputs (lb/config.ts)
- projectId
- environment
- domains: map of service -> domain list
- services: list of public services to expose and their regions
- urlMapPath: path to YAML desired state (generated or hand-authored)
- ipMode: "create" | "use-existing" (default: create for non-prod, use-existing for prod)
- ipName: when ipMode = use-existing, the name of the pre-provisioned Global Address to use
- certMode: "create" | "use-existing" (default: create for non-prod, use-existing for prod)
- certRef: when certMode = use-existing, reference to the existing certificate resource:
  - computeManagedCertName (for google_compute_managed_ssl_certificate), or
  - certificateManagerCertName / certificateMapName (if using Certificate Manager)

### Outputs (lb/outputs.ts)
- globalIpAddress
- urlMapName
- certificateResourceNames
- backendServiceNames

## 7. Orchestration with brat CLI
- `brat infra plan network`: synth network CDKTF to Terraform; run terraform plan
- `brat infra apply network`: terraform apply
- `brat infra plan lb`: synth; terraform plan backend services, certs, IP, proxies. URL map import step is skipped in plan.
- `brat infra apply lb`: after infra apply, run a guarded import step:
  - Describe current URL map; compute diff
  - If drift detected, run `gcloud compute url-maps import` with `--global --quiet` (unless `--dry-run`)
  - Re-describe to confirm state; log summary
- All operations support `--dry-run` and bounded concurrency; logs correlated by run ID.

## 8. Environment Strategy
- Separate workspaces/state per environment (GCS backend) — to be configured when implementing
- CIDR plans per env documented under env/<env>/network.yaml or architecture.yaml overlays
- URL map YAML per env stored alongside lb stack (checked-in); generation automated later

## 9. Naming Conventions
- VPC: `brat-vpc`
- Subnets: `brat-subnet-<region>-<env>`
- Router: `brat-router-<region>`
- NAT: `brat-nat-<region>`
- Serverless NEG: `neg-<service>-<region>`
- Backend Service: `be-<service>`
- URL Map: `bitbrat-global-url-map`
- IP address: `bitbrat-global-ip`
- Cert: `bitbrat-cert-<env>`

## 10. Compliance & Constraints
- Do not bundle brat CLI into any runtime images (see planning/sprint-4-b5a2d1/architecture-iac-cli.md §10)
- All configuration derived from architecture.yaml; avoid duplication across stacks
- Prefer Google-managed certs; bring-your-own certs supported via secret refs if required later

## 11. Risks & Mitigations
- Provider coverage gaps for URL map: YAML import with lifecycle ignore_changes; pre-import diff
- Certificate provisioning delays: provision early; add readiness checks before cutover
- Multi-region Cloud Run: ensure NEGs exist per region; consider traffic steering and failover in URL map
- State drift: regular `describe` audits; CI pipeline to detect and report

## 12. Next Steps
- Approve this architecture
- Implement CDKTF stacks and URL map import workflow
- Implement Serverless VPC Access Connectors (per region/env) and attach to subnets; expose outputs for connector names
- Add brat preflight enforcement to require VPC, subnet, router/NAT, and VPC connector before deploying services; add `--allow-no-vpc` override (dev-only)
- Add brat utilities to render URL map YAML from architecture.yaml
- Document per-environment connector CIDR sizing and APIs in env overlays; ensure vpcaccess.googleapis.com enabled
- Wire validation into Cloud Build and `validate_deliverable.sh`
