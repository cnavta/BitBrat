Technical Architecture — Derive LB Backends and URL Map from infrastructure.resources (and Provision Buckets)

Role: Cloud Architect
Source of truth: architecture.yaml
Date: 2025-11-18

Executive Summary
- Change how the Global External Application Load Balancer (ALB) determines backends and routes.
- Drive both backend service creation and URL Map routing directly from infrastructure.resources entries where type: load-balancer.
- Provision object-store resources (Cloud Storage buckets) declared under infrastructure.resources and enable routing to them.
- For bucket routing under the Application LB, route via an “assets proxy” Cloud Run backend by default (since backend buckets are not supported by External Managed ALB). Document an optional classic LB path for native backend buckets.

Current State (Problems)
- Backend provisioning depends on lb.services[] (separate from routing rules), creating duplication and drift risk.
- URL Map renderer reads infrastructure.resources.main-load-balancer.routing but assumes a default backend and does not fully support bucket targets.
- Buckets referenced in routing are not provisioned automatically.

Target State (Outcomes)
- Single source of truth: infrastructure.resources.* entries drive provisioning and routing.
  - Any resource with type: load-balancer and implementation: global-external-application-lb contains routing defaults and rules that determine required backends and URL Map.
  - Any resource with type: object-store and implementation: cloud-storage results in a provisioned GCS bucket, which can be referenced by routing rules.
- Services referenced by routing rules get be-<service> Backend Services and per‑region Serverless NEGs (Cloud Run targets) only if they are referenced.
- Bucket routes are served via an assets-proxy Cloud Run service backend by default.

Data Model & Validation (architecture.yaml)
- infrastructure.resources: map of named resources.
  - Buckets (object-store, cloud-storage)
    - Required: description (string)
    - access_policy: enum [private, public] (default private)
    - Optional: location (defaults to deploymentDefaults.region), versioning (bool), lifecycle (object), labels (map)
  - Load balancer (load-balancer, global-external-application-lb)
    - Required: name, ip, routing
    - routing:
      - default_domain: string
      - default_bucket: optional string referencing a bucket resource
      - rules: array of items with:
        - path_prefix: string (e.g., /oauth, /assets)
        - rewrite_prefix: optional string
        - Exactly one of:
          - service: string referencing a top-level service id
          - bucket: string referencing a resource of type object-store

Validation Rules to add in schema.ts
- Each routing rule must specify exactly one target (service XOR bucket).
- service reference must exist in services. Warn if service is inactive.
- bucket/default_bucket references must exist in infrastructure.resources and be type=object-store with implementation=cloud-storage.
- Collect referenced services and buckets for downstream synth.
- Backwards compatibility: If lb.services[] exists but a load-balancer resource with routing is present, prefer routing-based derivation and emit a warning about deprecation of lb.services[].

Provisioning Design
1) Buckets (object-store)
   - New CDKTF module: buckets.
   - For each object-store/cloud-storage resource:
     - Create google_storage_bucket with:
       - Name: normalized from resource key plus env (e.g., <key>-<env>)
       - Location: resource.location || deploymentDefaults.region
       - Versioning: enabled when configured
       - Lifecycle: apply if provided
       - IAM/public access:
         - private (default): no public bindings; assets-proxy reads with IAM
         - public: set uniform bucket-level access and bind allUsers: roles/storage.objectViewer
       - Labels: env, project, managed-by=brat
     - Outputs:
       - bucketNames[]
       - bucketUrlsByKey (gs:// and https://storage.googleapis.com/<bucket>)

2) Load Balancer (External Managed ALB)
   - Backend derivation from routing:
     - Gather set of referenced service ids from routing rules.
     - For each service id s:
       - Create per-region google_compute_region_network_endpoint_group targeting Cloud Run service s.
       - Create google_compute_backend_service be-service with logging enabled and attach NEGs.
     - Default backend: if any service rules exist, use the first service’s backend; otherwise synthesize be-default.
   - Bucket routing via assets proxy (default for ALB):
     - When bucket routes or default_bucket are present, require an assets-proxy Cloud Run service (document expectation).
     - Create a per-region NEG for the assets-proxy and a single backend be-assets-proxy.
     - URL Map renderer adds urlRewrite to encode the bucket key in the request path (e.g., /bucket/<bucketKey>/...). The proxy will use this to fetch from GCS.
   - Optional classic LB path (documented only):
     - For environments requiring native backend buckets, support a separate “classic” LB stack using google_compute_backend_bucket. Not enabled by default.

URL Map Renderer & Importer Changes
- Renderer:
  - Source routes exclusively from infrastructure.resources.<lb>.routing.
  - For service rules: target be-<service>.
  - For bucket rules: target be-assets-proxy and inject urlRewrite to include the bucket key per proxy contract.
  - Default service: if default_bucket exists, default to be-assets-proxy with rewrite; else use first be-<service> or be-default.
- Importer:
  - Extend backend existence guard to include be-assets-proxy and any be-<service> referenced by the YAML.
  - Non-prod: import changes when all backends exist; Prod: detect drift and report, do not import automatically.

CLI & Synth Changes
- tools/brat/src/config/schema.ts
  - Add cross-reference validation between routing rules, services, and bucket resources.
  - Surface deprecation warning for lb.services[] when resources-based routing is present.
- tools/brat/src/providers/cdktf-synth.ts
  - Add synthBucketsTf (new CdktfModule: 'buckets').
  - Update synthLoadBalancerTf to derive backends from routing rules and add be-assets-proxy when bucket routes exist.
  - Retain ip/cert mode behavior; URL Map resource remains scaffolded (ignore_changes) pending Sprint 18 importer parity work.
- tools/brat/src/lb/urlmap/renderer.ts
  - Adjust to emit bucket routes to be-assets-proxy with path rewrites.
- tools/brat/src/lb/importer/importer.ts
  - Extend guard to check be-assets-proxy existence.

Testing Strategy
- Schema tests:
  - Valid: service-only rules, bucket-only rules, mixed rules, default_bucket present.
  - Invalid: both service and bucket set on one rule; missing references; wrong resource type.
- Synth snapshot tests:
  - Buckets module: ensures google_storage_bucket resources and outputs.
  - LB module: given two service routes and one bucket route, only referenced service backends are created plus be-assets-proxy.
- Renderer tests:
  - Map service rules to be-<service> and bucket rules to be-assets-proxy with correct urlRewrite.
- Importer tests:
  - Skip import when any referenced backend (including be-assets-proxy) is missing.

Migration Plan
- Phase 1 (non-breaking):
  - Implement resources-based derivation while keeping lb.services[] as a fallback only when no load-balancer resource with routing exists.
  - Provision buckets via the new buckets module.
  - Require an existing assets-proxy service for dev/staging (documented with example image/Dockerfile outside this doc’s scope).
- Phase 2:
  - Deprecate lb.services[] officially and remove reliance once all consumers migrate to resources-based routing.

Operational Considerations
- IAM: assets-proxy service account needs storage.objects.get access to private buckets.
- Security: default buckets private; public requires explicit configuration and acknowledgment.
- Performance/Caching: Cloud CDN differs between ALB serverless NEGs and classic backend buckets; evaluate needs before enabling.
- Multi-project: allow per-service project overrides (existing pattern) if needed.

Acceptance Criteria
- Backend services and NEGs are synthesized only for services referenced by routing rules.
- Buckets declared as object-store resources are provisioned with correct policies and outputs.
- Bucket routes are served via be-assets-proxy in ALB mode; renderer/importer align and guards ensure safe import.
- Tests and dry-run plans pass for representative configs.

Definition of Done
- Schema validation and cross-reference checks implemented.
- New buckets module with tests and outputs.
- LB synth updated to routing-driven backends and assets-proxy handling.
- Renderer and importer updated; guards include assets-proxy.
- Documentation (this file) committed under planning/ with traceability to architecture.yaml.

Open Questions / Decisions
- Assets proxy naming: default be-assets-proxy and Cloud Run service name assets-proxy; later make configurable.
- Whether to optionally synthesize an assets-proxy service as part of infra (out of scope for now).
- Classic LB support remains optional and documented only.

Next Steps
1) Implement schema cross-reference validation and warnings.
2) Add buckets synth module and unit tests.
3) Update LB synth to be routing-driven and include assets-proxy when needed.
4) Extend renderer/importer and tests.
5) Provide migration guidance and deprecation notes for lb.services[].