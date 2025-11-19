# Sprint 17 — Execution Plan

Sprint ID: sprint-17-f7c3a2
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Reference: planning/sprint-13-ace12f/project-implementation-plan.md (Sprint 17 section)

## Objective & Scope
- Make connector ip_cidr_range and sizing overlay-driven; ensure preflight enforces presence during deploy.
- Reinforce deploy preflight to fail fast if required VPC/connector overlays are missing, with a documented dev-only override.

Out of Scope:
- URL map parity and importer behavior (Sprint 18).
- DNS/TLS readiness checks and Cloud Armor (Sprint 19).

## Deliverables
1) Config schema extensions
   - File: tools/brat/src/config/schema.ts
   - Add: connectors.perRegion[region] { cidr, minInstances, maxInstances }
   - Validation:
     - cidr must be a valid IPv4 CIDR in range /28 through /23 (inclusive)
     - minInstances and maxInstances are positive integers; min <= max
   - Notes:
     - The perRegion map keys must match declared/targeted regions in overlays.

2) CDKTF synth for Connectors
   - File: tools/brat/src/providers/cdktf-synth.ts
   - Function: synthConnectorsTf
   - Behavior:
     - Use connectors.perRegion map to synthesize connector resources per region
     - Remove any hardcoded ranges; use overlay-driven cidr and sizing
     - Expose outputs that list created connector names and effective ranges

3) Preflight reinforcement
   - File: tools/brat/src/providers/cdktf-synth.ts (or preflight module if present)
   - Function: assertVpcPreconditions (strengthen)
   - Behavior:
     - Verify that for all targeted regions, a connectors.perRegion entry exists
     - Fail with actionable error if missing; support a dev-only override flag (e.g., --allow-no-vpc) with clear messaging
   - Docs: document override behavior and intended dev-only scope

4) Documentation updates
   - planning examples for overlay snippets
   - Inline comments in architecture.yaml where appropriate (non-functional change; comments only)

5) Unit tests
   - Files:
     - tools/brat/src/config/schema.connectors.test.ts (new)
     - tools/brat/src/providers/cdktf-synth.connectors.test.ts (new)
   - Coverage:
     - Schema zod parsing for valid/invalid CIDR and bounds
     - Snapshot tests of synthesized connectors Terraform JSON for two regions

## Acceptance Criteria
- No hardcoded connector ranges remain; all values taken from architecture.yaml overlays.
- Preflight fails gracefully with clear messaging when connectors are missing for any targeted region, unless dev override is explicitly enabled.
- CI dry-run terraform plan for connectors across two regions completes successfully when overlays are present.
- Jest tests pass for schema validation and synth snapshots.

## Testing Strategy
- Unit tests with Jest for schema and synth snapshots.
- CI: cloudbuild.infra-plan.yaml runs `npm run brat -- infra plan connectors --env <env> --project-id <id> --dry-run` for dev overlay; optionally for a second region per overlay.
- Local: use root validate_deliverable.sh and this sprint’s validate shim to run connector plan in dry-run.

## Deployment Approach
- No direct production apply in this sprint; synth + plan in dry‑run only.
- Merge via PR; CI validates connector plans for configured env(s).

## Dependencies & External Systems
- Depends on Sprint 15 overlay work (regions/subnets) being available.
- GCP: VPC and required APIs enabled by earlier sprints.
- Terraform/CDKTF available for synth/plan.

## Definition of Done (DoD)
- Schema and synth changes implemented with unit tests and snapshots.
- Dry-run plans succeed for connectors across at least two regions.
- Preflight assertions strengthened and documented; dev-only override behavior documented.
- Documentation updated: this execution plan and backlog committed under planning/sprint-17-f7c3a2.

## Traceability
- Mirrors “Sprint 17 — Connectors Configurability + Preflight Reinforcement” from planning/sprint-13-ace12f/project-implementation-plan.md.
- All configuration sourced from architecture.yaml overlays; no hardcoded values.

## Planned Code Change Outline
- tools/brat/src/config/schema.ts
  - Extend ArchitectureSchema:
    - connectors: { perRegion: Record<string, { cidr: string; minInstances: number; maxInstances: number; }> }
  - Add validations:
    - CIDR format and mask bounds (/28–/23)
    - minInstances <= maxInstances; both >= 1

- tools/brat/src/providers/cdktf-synth.ts
  - Add/extend synthConnectorsTf(arch, overlay, options):
    - For each region in connectors.perRegion, synthesize connector resources using overlay values
    - Export outputs: connectorNames[], connectorCidrsByRegion

- Preflight
  - Strengthen assertVpcPreconditions to require connectors for all targeted regions
  - Add and document a dev-only override flag (--allow-no-vpc)

## Risks & Mitigations
- Risk: Invalid CIDR ranges causing plan failures.
  - Mitigation: Strict zod validation with descriptive errors; unit tests.
- Risk: Missing overlay entries in some regions.
  - Mitigation: Preflight check with clear messaging and dev-only override for local experimentation.
- Risk: CI instability due to remote backends.
  - Mitigation: Keep CI in plan-only mode; gate remote state via env flags as done in prior sprints.

## LLM Prompt Annotations
- llm_prompt: Derived from Issue — “Sprint 17 — Connectors Configurability + Preflight Reinforcement” and Sprint 13 plan.

## Trackable Backlog
This sprint uses a Trackable Backlog for day-to-day execution, mirroring the structure used in recent sprints. The authoritative backlog with detailed acceptance criteria and traceability is maintained here:

- planning/sprint-17-f7c3a2/backlog.md