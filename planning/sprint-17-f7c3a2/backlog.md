# Sprint 17 — Trackable Backlog

Sprint ID: sprint-17-f7c3a2
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plan: planning/sprint-17-f7c3a2/sprint-execution-plan.md

Notes
- Status markers: [ ] = not started, [*] = in progress, [x] = done
- Each task includes acceptance criteria and traceability to code/tests.

---

- [ ] S17-T1: Extend schema with connectors.perRegion { cidr, minInstances, maxInstances }
  - Acceptance Criteria:
    - ArchitectureSchema accepts connectors.perRegion with required fields
    - Validation: CIDR in /28–/23; min/max integers; min <= max
  - Code/Test Traceability:
    - Code: tools/brat/src/config/schema.ts
    - Tests: tools/brat/src/config/schema.connectors.test.ts

- [ ] S17-T2: Enforce perRegion keys match targeted regions
  - Acceptance Criteria:
    - Parsing fails with helpful message when a targeted region is missing from connectors.perRegion
  - Code/Test Traceability:
    - Code: tools/brat/src/config/schema.ts (refine with overlay context)
    - Tests: tools/brat/src/config/schema.connectors.test.ts

- [ ] S17-T3: Synthesize connectors per region using overlay values
  - Acceptance Criteria:
    - For each region entry, synth creates connector resources with overlay cidr and sizing
    - No hardcoded ranges remain
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts (synthConnectorsTf)
    - Tests: tools/brat/src/providers/cdktf-synth.connectors.test.ts (snapshot)

- [ ] S17-T4: Expose outputs for connectors
  - Acceptance Criteria:
    - Terraform JSON includes outputs: connectorNames[], connectorCidrsByRegion
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts
    - Tests: tools/brat/src/providers/cdktf-synth.connectors.test.ts

- [ ] S17-T5: Strengthen preflight (assertVpcPreconditions)
  - Acceptance Criteria:
    - Preflight fails when any targeted region lacks connectors config
    - Error message includes remediation guidance
    - Support dev-only override flag: --allow-no-vpc
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts (or preflight module)
    - Tests: add unit to simulate missing region config and override behavior

- [ ] S17-T6: Unit tests — schema validation
  - Acceptance Criteria:
    - Tests cover invalid CIDR masks, bounds, and min>max conditions
  - Code/Test Traceability:
    - Tests: tools/brat/src/config/schema.connectors.test.ts

- [ ] S17-T7: Unit tests — synth snapshots across two regions
  - Acceptance Criteria:
    - Snapshot confirms per-region resources and outputs
  - Code/Test Traceability:
    - Tests: tools/brat/src/providers/cdktf-synth.connectors.test.ts

- [ ] S17-T8: CI validation — connectors plan dry-run
  - Acceptance Criteria:
    - cloudbuild.infra-plan.yaml successfully runs `infra plan connectors` with overlays
    - Evidence captured in verification report
  - Code/Test Traceability:
    - Config: cloudbuild.infra-plan.yaml
    - Docs: planning/sprint-17-f7c3a2/verification-report.md (to be created later)

- [ ] S17-T9: Documentation updates
  - Acceptance Criteria:
    - Execution plan finalized and reflects implementation
    - Overlay examples committed; architecture.yaml comments updated as needed (non-functional)
  - Code/Test Traceability:
    - Docs: planning/sprint-17-f7c3a2/sprint-execution-plan.md

- [ ] S17-T10: Verification report prior to PR publication
  - Acceptance Criteria:
    - verification-report.md created summarizing completed/partial items
    - All deliverables either completed or explicitly deferred per Sprint Protocol
  - Code/Test Traceability:
    - Docs: planning/sprint-17-f7c3a2/verification-report.md

---

Validation Procedure
1) Local: ./validate_deliverable.sh --env dev --project-id <PROJECT_ID>
2) CI: Confirm cloudbuild.infra-plan.yaml completes the connectors plan step without errors

Traceability
- Mirrors the “Sprint 17” section of planning/sprint-13-ace12f/project-implementation-plan.md
- Aligns with architecture.yaml overlays; no hardcoded CIDR ranges
