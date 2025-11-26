# Sprint 16 — Execution Plan

Sprint ID: sprint-16-e3f9a1
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Reference: planning/sprint-13-ace12f/project-implementation-plan.md (Sprint 16 section)

## Objective & Scope
- Implement per-service Serverless NEGs and Backend Services derived from architecture.yaml overlays.
- Introduce lb.ipMode, lb.ipName, lb.certMode, lb.certRef, and lb.services[] as first‑class inputs in the config schema.
- Wire ipMode/certMode behavior into the CDKTF synth for non‑prod resource creation vs. use‑existing data sources in prod.
- Preserve URL map as a stub with ignore_changes; URL map YAML parity and import will be handled in Sprint 18.

Out of Scope:
- URL map parity and importer behavior (Sprint 18).
- DNS/TLS readiness checks and Cloud Armor (Sprint 19).

## Deliverables
1) Config schema extensions
   - File: tools/brat/src/config/schema.ts
   - Add: lb.ipMode, lb.ipName, lb.certMode, lb.certRef, lb.services[]
   - Notes:
     - ipMode: enum ["create", "use-existing"].
     - certMode: enum ["managed", "use-existing"].
     - certRef: when certMode == "use-existing", reference (name or selfLink) to an existing certificate.
     - services[]: array of service descriptors including name, regions (inherit default from overlays if omitted), and Cloud Run service references.

2) CDKTF synth for Load Balancer
   - File: tools/brat/src/providers/cdktf-synth.ts
   - Function: synthLoadBalancerTf
   - Behavior:
     - Create Serverless NEGs per service per region targeting Cloud Run services.
     - Create Backend Services per service and attach NEGs; enable logging.
     - ipMode handling:
       - Non‑prod: create global address if ipMode == "create"; otherwise data source lookup for existing address when ipMode == "use-existing".
       - Prod: always data source lookup for existing address when ipMode == "use-existing"; if ipMode == "create", emit warning and default to data source (no creation in prod).
     - certMode handling:
       - Non‑prod: create managed certificate when certMode == "managed"; otherwise data source lookup for existing cert when "use-existing".
       - Prod: data source lookup when "use-existing"; if "managed", synthesize managed cert resource but allow opt‑out via overlay (default to lookup in prod if unspecified).
     - Keep URL map as stub and mark ignore_changes on routes; expose outputs for negNames and backendServiceNames.

3) Unit tests
   - Files:
     - tools/brat/src/config/schema.test.ts (new or appended)
     - tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts (new)
   - Coverage:
     - Schema zod parsing for ipMode/certMode/services.
     - Snapshot tests of synthesized LB Terraform JSON for:
       - dev overlay (resource creation path)
       - prod overlay (data source path)

## Acceptance Criteria
- Dev dry‑run plan shows creation of NEGs and Backend Services per declared service/region and uses managed cert/global address when configured.
- Prod dry‑run plan resolves existing IP and certificate via data sources; no creation of these resources unless explicitly allowed.
- Outputs include backendServiceNames and negNames.
- Jest tests are passing with snapshots for dev and prod modes.

## Testing Strategy
- Unit tests with Jest for schema and synth snapshots.
- CI: cloudbuild.infra-plan.yaml runs `npm run brat -- infra plan lb --env <env> --project-id <id> --dry-run` for dev and prod overlays.
- Validate via validate_deliverable.sh which already executes LB plan in dry‑run.

## Deployment Approach
- No direct deployment in this sprint; only CDKTF synth and plan in dry‑run.
- Merge via PR; CI validates plans for configured env(s).

## Dependencies & External Systems
- Relies on Sprint 15 overlays for regions/services (as per planning doc).
- GCP: Cloud Run services exist or are referenced for NEG targets.
- Terraform/CDKTF available in dev environment for synth/plan.

## Definition of Done (DoD)
- Schema and synth changes implemented with unit tests and snapshots.
- Dry‑run plans succeed for dev and prod overlays.
- Outputs expose backendServiceNames and negNames.
- Documentation updated: this execution plan and backlog committed under planning/sprint-16-e3f9a1.

## Traceability
- Mirrors “Sprint 16 — LB Backends: NEGs + Backend Services; ipMode/certMode Inputs” from planning/sprint-13-ace12f/project-implementation-plan.md.
- References architecture.yaml overlays for lb configuration; no hardcoded values.

## Planned Code Change Outline
- tools/brat/src/config/schema.ts
  - Extend ArchitectureSchema to include:
    - lb: { ipMode, ipName?, certMode, certRef?, services: ServiceSpec[] }
    - type ServiceSpec = { name: string; regions?: string[]; runService?: { name: string; projectId?: string; } }
  - Add validations and sensible defaults (e.g., inherit regions from overlay).

- tools/brat/src/providers/cdktf-synth.ts
  - Add/extend synthLoadBalancerTf(arch, overlay, options):
    - For each service and region:
      - Create google_compute_region_network_endpoint_group with serverless deployment for Cloud Run
      - Create google_compute_backend_service and attach per‑region NEGs
    - Address and certificate handling via resources or data.* per mode
    - Export outputs: negNames, backendServiceNames

## Risks & Mitigations
- Risk: Prod mistakenly creates IP/Cert. Mitigation: default prod to data source lookups and log warnings if create is requested.
- Risk: Snapshot brittleness. Mitigation: Tighten matcher selection and use filtered snapshots for dynamic fields.

## LLM Prompt Annotations
- llm_prompt: Derived from Issue — “Sprint 16 — LB Backends: NEGs + Backend Services; ipMode/certMode Inputs” and Sprint 13 plan.

## Trackable Backlog
This sprint uses a Trackable Backlog for day-to-day execution, mirroring the structure used in Sprint 14. The authoritative backlog with detailed acceptance criteria and traceability is maintained here:

- planning/sprint-16-e3f9a1/backlog.md

Snapshot of current items:
- [ ] S16-T1: Extend schema with lb.ipMode/ipName/certMode/certRef/services[]
- [ ] S16-T2: Synthesize per-service Serverless NEGs and Backend Services
- [ ] S16-T3: Implement ipMode behavior for dev/prod (create vs. use-existing)
- [ ] S16-T4: Implement certMode behavior for dev/prod (managed vs. use-existing)
- [ ] S16-T5: Expose outputs: negNames and backendServiceNames
- [ ] S16-T6: Unit tests — schema parsing/validation
- [x] S16-T7: Unit tests — synth snapshots for dev/prod overlays
- [*] S16-T8: CI validation — cloudbuild.infra-plan.yaml runs LB plan dry-run and passes
- [x] S16-T9: Documentation updates (execution plan fine-tuning, decisions log)

## Design Decisions & Prod Safety (Sprint 16 Updates)

1) ipMode behavior
- Dev/Non‑prod: If ipMode=create, synthesize resource google_compute_global_address.frontend_ip; otherwise use data source lookup. This supports sandbox creation without affecting shared/global resources.
- Prod: Regardless of ipMode, default to data source lookup for safety. If ipMode=create is explicitly configured, we still fall back to lookup; creation in prod is not performed in this sprint.

2) certMode behavior
- Dev/Non‑prod: If certMode=managed, synthesize google_compute_managed_ssl_certificate.managed_cert with overlay-provided or legacy default domain. If certMode=use-existing, resolve via data.google_compute_ssl_certificate.
- Prod: Default to data source lookup for existing certificates. If managed is explicitly configured, we allow managed synthesis but expect production overlays to opt out by default. This maintains flexibility with guardrails.

3) Backend Services and NEGs
- For each lb.services[] and region, we create a serverless NEG targeting Cloud Run, and a Backend Service per service with logging enabled and NEGs attached. If services[] is empty, a default backend is synthesized to maintain URL map validity.

4) Outputs for integration
- Expose output lists: backendServiceNames and negNames to support downstream wiring (e.g., URL map parity in Sprint 18).

5) Remote backend gating in CI
- Similar to other modules, remote state backends are gated by env (disabled when CI=true) to keep plan-only behavior stable in Cloud Build.

6) CI-safe doctor flag
- cloudbuild.infra-plan.yaml runs `brat doctor --json --ci` to avoid failing due to missing gcloud/terraform/docker in the npm builder image.
- [ ] S16-T10: Verification report prior to PR publication
