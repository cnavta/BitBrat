# Technical Architecture — Close-out of Infra Gaps (S7–S12)

Sprint: sprint-13-ace12f
Date: 2025-11-15
Role: Cloud Architect
Source of Truth: architecture.yaml
Related References:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md
- planning/sprint-12-f2b7a8/execution-plan.md
- tools/brat/src/providers/cdktf-synth.ts (synthNetworkTf, synthConnectorsTf, synthLoadBalancerTf)
- tools/brat/src/lb/urlmap/* (renderer, importer)

## 1. Purpose & Scope
This document defines the technical approach to close the outstanding infrastructure gaps enumerated under “What is NOT complete” in the latest Gap Analysis. The scope spans CI wiring, Network and Connector configurability, Load Balancer backends (NEGs/Backend Services), URL Map YAML parity and guarded import, production cutover checks (DNS/TLS), optional Cloud Armor, and validation/publication wiring. The intent is to align all inputs to architecture.yaml and its environment overlays and to make brat CLI the single orchestrator for synth/plan/apply and URL map import.

## 2. Target Outcomes (mapped to open gaps)
1) CI plan job clarity (Sprint 7)
- Ensure a dedicated Cloud Build config exists and is linked to PRs that runs infra plan jobs:
  - npm ci && npm run build
  - npm run brat -- infra plan network --env $ENV --project-id $PROJECT_ID --dry-run
  - npm run brat -- infra plan connectors --env $ENV --project-id $PROJECT_ID --dry-run
  - npm run brat -- infra plan lb --env $ENV --project-id $PROJECT_ID --dry-run
  - npm run brat -- lb urlmap import --env $ENV --project-id $PROJECT_ID --dry-run
- Artifact: cloudbuild.infra-plan.yaml (already present; verify steps match above and are referenced from triggers).

2) Network MVP gaps (Sprint 8)
- Flow logs toggle per subnet: enable via overlay boolean (default false in dev, true in prod). Emit subnet logConfig when enabled.
- Per-region subnets from overlays: remove hardcoded CIDR; drive regions and CIDR map from architecture.yaml overlays.
- Remote state: configure per-env/workspace (GCS bucket + prefix) via overlays; continue to support env gating to avoid remote state in ephemeral CI.

3) LB stack backends & modes (Sprint 9)
- Implement Serverless NEGs and per-service Backend Services derived from architecture.yaml public services:
  - Create serverless NEG per service per region used by that service (Cloud Run target).
  - Create Backend Service per service; attach regional NEGs (capacityScaler=1.0), logging enabled.
- Expose ipMode/certMode as first-class inputs to synth (create vs use-existing) with data-source wiring for use-existing and resource creation for create.

4) Connectors configurability (Sprint 10)
- Make connector ip_cidr_range configurable via overlays per environment/region instead of fixed 10.8.0.0/28.
- Allow sizing (min/max instances) via overlays with sane defaults; validate and bound values.
- Document connector sizing and APIs in planning + examples in overlays.

5) URL Map YAML parity and guarded import (Sprint 11)
- Ensure the renderer uses architecture.yaml to generate desired YAML at infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml.
- Guarded import behavior:
  - Non-prod: auto render + import post-apply; compute diff against describe; import only on drift.
  - Prod: render and diff only by default; manual import step via documented runbook.
- Keep Terraform URL map as stub with lifecycle ignore_changes.

6) Production cutover & hardening (Sprint 12)
- DNS readiness checks: script that validates that required FQDNs resolve to the intended Global IP and that TLS handshakes succeed with expected SANs.
- TLS cert status checks: preflight that enforces ACTIVE status for prod apply when using existing certs (Compute or Certificate Manager).
- Optional Cloud Armor: scaffold policy and attach flag; disabled by default, attachable in prod via overlay.
- Validation enhancements: extend root validate_deliverable.sh to run infra plan and URL map dry-run import for target env; add sprint-scoped validator.
- Publication: ensure PR creation and linkage as per Sprint Protocol (S11–S13).

## 3. Canonical Inputs (architecture.yaml overlays)
All parameters must be sourced from architecture.yaml (with env overlays):

- env.environment: "dev" | "staging" | "prod"
- env.projectId: GCP project ID
- network:
  - regions: string[] (e.g., ["us-central1"]) 
  - subnets: map<region, { name?: string, cidr: string }>
  - enableFlowLogs: boolean
  - remoteState: { bucket: string, prefix: string } (optional)
- connectors:
  - perRegion: map<region, { cidr: string, minInstances?: number, maxInstances?: number }>
- lb:
  - ipMode: "create" | "use-existing"
  - ipName?: string (when use-existing)
  - certMode: "create" | "use-existing"
  - certRef?: { computeManagedCertName?: string, certificateManagerCertName?: string, certificateMapName?: string }
  - domains: string[] (SANs for certs)
  - services: array<{ name: string, regions: string[] }>
  - urlMap: { name: string, filePath: string } (filePath resolved per env)
  - cloudArmor?: { enabled: boolean, policyName?: string }

## 4. Outputs
- Network: vpcSelfLink; subnetSelfLinks map; routers map; nats map
- Connectors: connectorNames map (region->name)
- LB: globalIpAddress; urlMapName; certificateResourceRefs; negNames map; backendServiceNames map

## 5. CDKTF Synth Changes (tools/brat/src/providers/cdktf-synth.ts)
- synthNetworkTf(config):
  - Accept regions[] and subnets map; for each region, create subnet with Private Google Access; when enableFlowLogs=true, emit log_config { aggregation_interval, flow_sampling, metadata } using GCP defaults unless overlay overrides later.
  - Support remote state by accepting backend config via env overlays (bucket/prefix) and only enabling when provided.
- synthConnectorsTf(config):
  - Accept perRegion map of CIDR and sizing; validate CIDR is /28–/23; default min/max=2; expose outputs by region.
- synthLoadBalancerTf(config):
  - Implement serverless NEGs per service/region and backend services per service with logging.
  - ipMode/certMode: when use-existing, use data sources (global address, managed cert or certificate manager). When create, manage resources and output names.
  - Keep URL map as stub with ignore_changes; proxy and forwarding rule reference the URL map and cert appropriately; attach optional Cloud Armor policy when enabled.

## 6. URL Map Strategy
- Renderer reads architecture.yaml to generate hostRules, pathMatchers, and routeRules referencing backend service selfLinks: https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/be-<service>
- Generated YAML is written to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml and committed.
- Importer performs describe/diff/import. Non-prod auto-import post-apply; prod plan-only by default with a documented manual step.

## 7. CLI Orchestration (brat)
- brat apis enable --env <env> --project-id <id>
- brat infra plan|apply network|connectors|lb --env <env> --project-id <id> [--dry-run]
- brat lb urlmap render --env <env> --project-id <id> [--out <path>]
- brat lb urlmap import --env <env> --project-id <id> [--dry-run]
- Deploy preflight: assertVpcPreconditions invoked by brat deploy services; prod apply additionally enforces cert ACTIVE when use-existing.

## 8. CI/CD Integration (Cloud Build)
- cloudbuild.infra-plan.yaml should:
  - Install deps and build
  - Run brat infra plan network|connectors|lb and URL map import in dry-run for the target env
  - Emit artifacts: plan outputs and diff logs
- cloudbuild.brat.yaml continues to support other brat commands; ensure infra plan config is referenced by PR triggers.

## 9. DNS/TLS Readiness Checks
- Script: scripts/check_dns_tls.sh (to be added in implementation sprint):
  - For each domain, verify A/AAAA resolve to the configured Global IP
  - Perform TLS handshake (openssl s_client) and verify SANs include domain; exit non-zero on failure
- Validate within root validate_deliverable.sh and within sprint validator.

## 10. Optional Cloud Armor
- Overlay flag lb.cloudArmor.enabled controls attaching a pre-created or managed policy:
  - When enabled and policyName set: attach policy to target HTTPS proxy or backend as required
  - Default disabled in non-prod; enabled via explicit overlay in prod only after review

## 11. Testing Strategy
- Unit tests:
  - Schema validation for overlays (zod) for new fields (regions, subnets, flow logs, connectors, lb modes, cloud armor)
  - Synth snapshots for network (multiple regions), connectors, and lb (NEGs + backends)
  - URL map renderer fixtures and diff logic
- Integration tests:
  - Terraform plan for network/lb/connectors against a test project (dry-run in CI)
  - URL map import in non-prod sandbox (guarded)

## 12. Definition of Done (for this close-out architecture)
- All inputs are driven by architecture.yaml overlays; no hardcoded CIDRs, regions, or connector ranges remain in synth functions.
- LB backends implemented with NEGs per service/region and backend services per service with logging enabled.
- ipMode/certMode exposed and respected; use-existing verified via preflights; create mode creates resources in non-prod.
- URL map YAMLs generated from architecture.yaml and committed; non-prod auto-import; prod diff only by default.
- DNS/TLS readiness checks and optional Cloud Armor scaffolding are documented and ready to implement.
- CI infra-plan job runs in PRs and publishes plan/diff artifacts.
- Root validation includes infra plan and URL map dry-run import; sprint-scoped validator present.
- Publication via PR with links to this document and validation artifacts.

## 13. Risks & Mitigations
- Provider gaps for URL map: continue YAML-first import with lifecycle ignore_changes
- Cert provisioning delays: enforce ACTIVE for prod preflight; perform checks ahead of cutover
- Misconfigured overlays: strict schema validation with descriptive errors; CI exercises plan across envs
- Accidental prod changes: default to plan-only and guarded imports; manual approval gates

## 14. Traceability
- Derives from planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md and the Gap Analysis (Analyze_the_current_state_of_the_codebas.md)
- Implements recommendations in that analysis and aligns to Sprint Protocol v2.2
