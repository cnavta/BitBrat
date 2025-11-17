# Sprint 16 — Trackable Backlog

Sprint ID: sprint-16-e3f9a1
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plan: planning/sprint-16-e3f9a1/sprint-execution-plan.md

Notes
- Status markers: [ ] = not started, [*] = in progress, [x] = done
- Each task includes acceptance criteria and traceability to code/tests.

---

- [x] S16-T1: Extend schema with lb.ipMode/ipName/certMode/certRef/services[]
  - Acceptance Criteria:
    - ArchitectureSchema accepts new lb fields with documented enums and conditionals
    - Validation rules: ipMode in [create|use-existing], certMode in [managed|use-existing], certRef required when certMode=use-existing
    - Services[] supports name, optional regions[], and runService{name, projectId?}
  - Code/Test Traceability:
    - Code: tools/brat/src/config/schema.ts
    - Tests: tools/brat/src/config/schema.test.ts (new/updated)

- [x] S16-T2: Synthesize per-service Serverless NEGs and Backend Services
  - Acceptance Criteria:
    - For each lb.services[] and region, a serverless NEG targets the Cloud Run service
    - A Backend Service per service aggregates NEGs; logging enabled
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts (synthLoadBalancerTf)
    - Tests: tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts

- [x] S16-T3: Implement ipMode behavior for dev/prod (create vs. use-existing)
  - Acceptance Criteria:
    - Non-prod: create global address when ipMode=create; use data source when use-existing
    - Prod: default to data source; if create requested, emit warning and fall back to lookup
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts
    - Tests: cdktf-synth.loadbalancer.test.ts snapshot assertions per env

- [x] S16-T4: Implement certMode behavior for dev/prod (managed vs. use-existing)
  - Acceptance Criteria:
    - Non-prod: create managed cert when certMode=managed; data source when use-existing
    - Prod: default to lookup; allow overlay to opt-in to managed but treat as guarded
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts
    - Tests: cdktf-synth.loadbalancer.test.ts snapshots cover both modes

- [x] S16-T5: Expose outputs: negNames and backendServiceNames
  - Acceptance Criteria:
    - Terraform JSON includes outputs listing created/data-wired resources
  - Code/Test Traceability:
    - Code: tools/brat/src/providers/cdktf-synth.ts
    - Tests: cdktf-synth.loadbalancer.test.ts validates outputs in snapshots

- [x] S16-T6: Unit tests — schema parsing/validation
  - Acceptance Criteria:
    - Zod schema tests cover happy paths and invalid combinations (e.g., missing certRef)
  - Code/Test Traceability:
    - Tests: tools/brat/src/config/schema.test.ts

- [x] S16-T7: Unit tests — synth snapshots for dev/prod overlays
  - Acceptance Criteria:
    - Snapshot files for dev and prod confirm resource/data wiring and outputs
  - Code/Test Traceability:
    - Tests: tools/brat/src/providers/cdktf-synth.loadbalancer.test.ts

- [*] S16-T8: CI validation — cloudbuild.infra-plan.yaml runs LB plan dry-run and passes
  - Acceptance Criteria:
    - Cloud Build job completes lb plan step for target env(s) with zero exit status
  - Code/Test Traceability:
    - Config: cloudbuild.infra-plan.yaml
    - Evidence: CI logs attached in verification report (pending — acknowledged and carried forward)

- [x] S16-T9: Documentation updates (execution plan fine-tuning, decisions log)
  - Acceptance Criteria:
    - sprint-execution-plan.md reflects any design changes made during implementation
    - Decisions around prod safety documented
  - Code/Test Traceability:
    - Docs: planning/sprint-16-e3f9a1/sprint-execution-plan.md

- [x] S16-T10: Verification report prior to PR publication
  - Acceptance Criteria:
    - verification-report.md created summarizing completed/partial items
    - All deliverables either completed or explicitly deferred per Sprint Protocol
  - Code/Test Traceability:
    - Docs: planning/sprint-16-e3f9a1/verification-report.md

---

Validation Procedure
1) Local: ./validate_deliverable.sh --env dev --project-id <PROJECT_ID>
2) CI: Confirm cloudbuild.infra-plan.yaml completes for lb plan step without errors

Traceability
- Mirrors the “Sprint 16” section of planning/sprint-13-ace12f/project-implementation-plan.md
- Aligns with architecture.yaml overlays; no hardcoded regions/services
