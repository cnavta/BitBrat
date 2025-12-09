Implementation Plan - sprint-117-47b27d

Objective
- Introduce distributed tracing for message flows using Google Cloud Trace with log-to-trace correlation in Cloud Logging. Deliver a trackable backlog and an approved plan before code changes.

Scope
- In scope:
  - Planning artifacts: backlog.yaml, implementation plan, validation scaffolding
  - Tracing design using OpenTelemetry SDK + Cloud Trace exporter
  - Per-service instrumentation plan (no code yet)
- Out of scope (this sprint stage):
  - Production code changes prior to user approval
  - Rollout automation or Terraform changes

Deliverables
- planning/sprint-117-47b27d/backlog.yaml (trackable YAML backlog)
- planning/sprint-117-47b27d/implementation-plan.md (this document)
- planning/sprint-117-47b27d/validate_deliverable.sh (planning validation script)
- planning/sprint-117-47b27d/verification-report.md (stub)
- planning/sprint-117-47b27d/publication.yaml (stub)
- planning/sprint-117-47b27d/retro.md (stub)
- planning/sprint-117-47b27d/key-learnings.md (stub)

Acceptance Criteria
- A structured backlog exists with cross-cutting and per-service tasks, each with acceptance, priority, and status
- Plan defines how traces propagate and how logs correlate to traces
- Clear env flags (TRACING_ENABLED, TRACING_SAMPLER_RATIO) proposed
- Validation script is logically passable locally (build+test) without requiring credentials

Testing Strategy
- Unit tests to verify logger enrichment when tracing is enabled (follow-up sprint)
- Integration tests simulating publish→consume traces (follow-up sprint)
- For planning validation: run build and tests with message bus disabled

Deployment Approach
- Runtime: Cloud Run (per architecture.yaml)
- Cloud Trace exporter via OpenTelemetry SDK in Node.js
- Pub/Sub trace propagation relies on Google client and Cloud Run push subscriptions
- Sampling initially 10% (configurable via env)

Dependencies
- Google Cloud project with Cloud Trace & Logging enabled (for later validation)
- OpenTelemetry packages and @google-cloud/opentelemetry-cloud-trace-exporter

Definition of Done
- Aligns with project DoD: code quality, tests, deployment artifacts, documentation, traceability
- This stage completes when the backlog and plan are approved; subsequent sprint steps will implement code and tests referencing this plan.

Next Steps After Approval
1. Implement BaseServer tracer bootstrap and getTracer() API
2. Add child spans in llm-bot and other services as outlined
3. Ensure logger writes trace correlation fields
4. Add tests and docs; validate in Cloud Console
