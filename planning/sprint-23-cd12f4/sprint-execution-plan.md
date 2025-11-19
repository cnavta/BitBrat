Welcome to Sprint 23 — URL Map Renderer and Importer Enhancements

Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Design:
- planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md
- planning/sprint-17-f7c3a2/implementation-plan-lb-routing-from-infrastructure-resources.md

Date: 2025-11-18

1. Objective & Scope
- Render URL Map YAML exclusively from infrastructure.resources.<lb>.routing.
- Route bucket rules via be-assets-proxy with path rewrite per proxy contract.
- Extend importer backend-existence guard to include be-assets-proxy and any be-<service> referenced.
- Maintain environment policy: non-prod imports automatically; prod performs drift detection only.

Out of Scope
- Provisioning assets-proxy service or IAM changes.
- Classic LB backend bucket support beyond documentation.

2. Deliverables
- Code
  - tools/brat/src/lb/urlmap/renderer.ts
    - Use infrastructure.resources.<lb>.routing only.
    - Map service rules -> be-<service>.
    - Map bucket rules -> be-assets-proxy with urlRewrite including bucket key.
    - Default backend: be-assets-proxy when default_bucket exists; else first be-<service>; else be-default.
  - tools/brat/src/lb/importer/importer.ts
    - Extend backend existence guard: ensure be-assets-proxy and each referenced be-<service> exist before import.
    - Respect policy: non-prod auto-import; prod drift-only.
- Tests (Jest)
  - tools/brat/src/lb/urlmap/__tests__/renderer.routing.test.ts
    - Bucket-only, service-only, mixed routing; asserts rewrite correctness and default backend selection.
  - tools/brat/src/lb/importer/__tests__/importer.guard.test.ts
    - Guard includes be-assets-proxy; skips import when missing; environment policy behavior.
- Artifacts
  - URL Map YAML written to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml.
  - Planning docs in planning/sprint-23-cd12f4.

3. Acceptance Criteria
- Renderer emits expected YAML for all routing combinations.
- Default backend selection follows rules above.
- Importer guard requires be-assets-proxy when any bucket routing or default_bucket exists.
- Non-prod: import runs when backends exist; Prod: drift-only with guidance in logs.
- Tests pass locally and in CI.

4. Testing Strategy
- Unit tests for renderer and importer as described.
- Snapshot stable parts of YAML (normalize dynamic fields).
- Mock external calls in importer to avoid side effects.
- Run via root validate_deliverable.sh (which runs npm install/build/test) and ensure this sprint adds/updates tests only.

5. Deployment Approach
- No production applies; importer operates in guarded mode.
- URL Map YAML generation is file-based; importer executes in dry-run or detection per environment.
- Cloud Build infra-plan continues to run dry-run steps.

6. Dependencies
- Prior sprints 20–22 for schema, buckets, and routing-driven backends.
- GCP project & permissions; assets-proxy Cloud Run service exists when bucket routing is used.
- architecture.yaml definitions for infrastructure.resources.

7. Risks & Mitigations
- Missing assets-proxy service: guard prevents import; provide clear guidance in logs.
- Legacy lb.services[] in configs: renderer must ignore in favor of routing; log deprecation if both present (handled in schema per Sprint 20).
- Snapshot flakiness: focus on stable keys and normalize dynamic fields.

8. Definition of Done (DoD)
- All new tests pass (renderer and importer).
- URL Map YAML successfully written to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml in local dry-run.
- Documentation and traceability maintained linking to architecture.yaml and upstream design.
- PR created with links to this plan and verification evidence.

9. Work Breakdown & Milestones
- M1: Renderer refactor to exclusive routing source and bucket rewrite support.
- M2: Importer guard extended for be-assets-proxy and referenced services.
- M3: Unit tests for renderer and importer added and passing.
- M4: Validate end-to-end locally via validate_deliverable.sh.
- M5: Publish PR per Sprint Protocol with links to planning docs.

10. Verification Plan
- Deliverable Parity Verification before PR: compare these deliverables vs outputs; generate verification notes in PR body.

11. Traceability
- Aligns with architecture.yaml: infrastructure.resources load-balancer routing and object-store references.
- Implements Section “URL Map Renderer & Importer Changes” from the technical architecture.
