# Phase 2 Implementation Plan — brat CLI (BitBrat Rapid Administration Tool)

Sprint: sprint-4-b5a2d1
Role: Lead Implementor
Source of Truth: architecture.yaml
Status: Proposed (for approval)
Date: 2025-11-11

## Objective
Deliver Phase 2 features that deepen parity, observability, and safety of the brat CLI while keeping deploy-cloud.sh unchanged. Focus on:
- Secrets verification (pre-flight) and improved resolution ergonomics
- Richer concurrency reporting and machine-readable summaries
- Cloud Build trigger management with idempotent behavior
- Initial migration to official GCP Node SDKs with controlled gcloud fallback
- Standardized logging and error model across commands

## Scope (Phase 2)
1) Secrets Commands
- `brat secrets check [--project-id --env] [--services <name...>|--all]`
  - Verify that every secret declared for selected services in architecture.yaml exists in Secret Manager and has at least one ENABLED version.
  - Exit non-zero if any secret is missing or lacks ENABLED versions.
  - Output table to console and optional `--json` report for CI.
- `brat secrets resolve` improvements
  - Add `--format kv|mapping|json` to emit different forms of the mapping.
  - Emit warning when multiple ENABLED versions exist (still choose newest by createTime desc).

2) Concurrency & Summaries (deploy services)
- Per-task timing: add start/end timestamps and durations to logs.
- End-of-run aggregate summary: total, succeeded, failed, skipped, dry-run counts, and per-service durations.
- New flag `--summarize json|table` to control final output; default: table for humans.

3) Trigger Management
- New commands: `brat trigger create|update|delete`
  - Flags: `--github-connection`, `--github-repo`, `--branch`, `--cb-location`, `--build-sa`, `--trigger-name`.
  - Behavior: Idempotent; create when missing, update when present, delete if exists.
  - Prefer Google Cloud Build Node SDK; fallback to `gcloud` via exec with strict parsing.
  - Always support `--dry-run` to preview actions.

4) SDK Migration (initial)
- Use Google Secret Manager SDK for `secrets resolve|check` by default.
- Introduce Cloud Build SDK for read-only operations (describe/list builds, get trigger), continue submit via gcloud.
- Add Cloud Run Admin SDK utility wrapper for later (read-only describe/list services only; no deploy in Phase 2).
- Add feature toggle `--use-sdk` or env `BRAT_USE_SDKS=true` (default true; fallback to gcloud if SDK call fails or flag disables).

5) Logging & Error Model
- Standardize error classes and exit codes across new commands (reuse Phase 1 mapping):
  - ConfigurationError=2, DependencyError=3, PermissionError=4, ResourceStateError=5
- Propagate `runId` and `command` fields in base logger context; attach per-task fields (service, triggerName).
- Ensure all commands support `--json` output for CI consumption when applicable.

Out of Scope (Phase 2)
- CDKTF provisioning for networks/LBs (Phase 3)
- Decommissioning deploy-cloud.sh (Phase 5)
- Full oclif migration (may begin in Phase 3 without breaking entrypoints)

## Deliverables
- Code (tools/brat)
  - New command handlers wired into the existing CLI entrypoint:
    - secrets: `check`, `resolve` enhancements
    - deploy services: summary generator and `--summarize` flag
    - trigger: `create`, `update`, `delete`
  - Providers
    - gcp/secrets-sdk.ts (Secret Manager SDK-based resolver and checker)
    - gcp/cloudbuild-sdk.ts (read-only trigger/get/list; submit remains gcloud)
    - gcp/cloudrun-sdk.ts (read-only descriptors)
  - Orchestration
    - summary.ts: aggregate and per-task duration computation, JSON schema for summaries
    - errors.ts: ensure consistent categories/exit-codes and enrich messages
- Tests
  - Unit tests for secrets check/resolve, summary generator, trigger idempotency logic (mocked SDKs), and SDK fallbacks
  - Snapshot tests for `--summarize json`
- Docs
  - Update planning/request-log.md with req-007 entries
  - Update architecture-iac-cli.md (optional appendix note on Phase 2 SDK introduction)

## Command Specifications
- `brat secrets check [--project-id <id>] [--env <name>] [--services name...] [--all] [--json] [--use-sdk|--no-use-sdk]`
  - Behavior: For each selected service, check each secret in Secret Manager; mark missing or with no ENABLED versions; exit non-zero if any failures.
- `brat secrets resolve [--project-id <id>] [--env <name>] [--services name...] [--format kv|mapping|json] [--use-sdk|--no-use-sdk]`
  - Behavior: Emit mapping using newest ENABLED version per secret; warn when multiple ENABLED versions exist.
- `brat deploy services --all [--summarize json|table] [--concurrency N] [--dry-run]` (existing)
  - Behavior changes: add per-task timing and final summary output; when `--summarize json` emit machine-readable report.
- `brat trigger create|update|delete --trigger-name <name> --github-connection <name> --github-repo <owner/repo> --branch <branch|regex> --cb-location <loc> --build-sa <email> [--dry-run] [--use-sdk|--no-use-sdk]`
  - Behavior: Idempotent CRUD with dry-run previews; prefer SDK.

## Work Breakdown Structure (WBS)
1. Foundations and Feature Flags
- Add `--use-sdk` global toggle (and env BRAT_USE_SDKS) with default true.
- Add `summary.ts` module to compute timings and aggregate results.

2. Secrets
- Implement Secret Manager SDK wrapper (list secret versions, filter ENABLED, newest by createTime).
- Implement `secrets check` command:
  - Resolve target services from args (`--all` or explicit list).
  - For each secret, call SDK; collect status (exists, enabledVersionCount).
  - Render table and JSON; exit 1 when any missing/disabled.
- Enhance `secrets resolve` to support `--format` and warnings on multi-ENABLED.
- Add fallback to `gcloud` when SDK fails or disabled.

3. Deploy Services Summary
- Instrument deploy task scheduler to capture start/end times.
- Implement aggregate summary including counts/durations.
- Add `--summarize` flag and print table (human) or JSON (CI).
- Ensure dry-run paths produce consistent summary with dryRun=true markers.

4. Trigger Management
- Implement Cloud Build SDK client for triggers (get/create/update/delete) and list.
- Define idempotency logic:
  - create: if not exists → create; if exists → update when fields differ.
  - update: if exists → patch fields; if not exists → error unless `--create-if-missing` (future).
  - delete: if exists → delete; else no-op.
- Integrate `--dry-run` preview.
- Provide gcloud fallback implementation paths.

5. SDK Utilities (read-only)
- Cloud Build: add describe/list builds helper for future observability.
- Cloud Run Admin: add describe/list services (no write operations) for future health checks.

6. Logging & Errors
- Ensure new commands use standard error classes and include `runId`, `command`, `service`, `triggerName` fields in logs.
- Map errors to exit codes; include helpful remediation in messages.

7. Tests
- Unit tests: secrets check/resolve (SDK mocked), summary aggregation (durations, counts), trigger idempotency logic.
- Integration (dry-run): run `deploy services --all --dry-run --summarize json` against the repo to assert summary schema.
- Snapshots for JSON summary shape.

8. Documentation & Examples
- Add examples to planning docs for common usages.
- Update request-log.md with req-007 entries.

## Acceptance Criteria
- `brat secrets check` exits non-zero when any required secret is missing or lacks an ENABLED version; supports `--json` report.
- `brat secrets resolve` supports `--format` and warns on multi-ENABLED; continues to choose newest ENABLED.
- `brat deploy services` prints an end-of-run summary and supports `--summarize json|table`.
- Trigger commands are idempotent, respect `--dry-run`, and prefer SDK with gcloud fallback.
- SDK-based secrets resolution is implemented behind a feature flag; fallback to gcloud works.
- All new unit tests pass; existing tests remain green; validate_deliverable.sh passes.
- No changes to packaging boundary: brat artifacts remain excluded from service images.

## Testing Strategy
- Mock SDK clients with jest.fn() and provide fixtures for:
  - Secrets: missing secret, no ENABLED version, multiple ENABLED, single ENABLED
  - Triggers: exists vs missing, update diffs, delete absent
- Snapshot testing for JSON summary output schema and example data.
- Dry-run integration test to ensure command completes and emits summary without external calls.
- Coverage goal: ≥75% for new modules.

## Risks & Mitigations
- IAM permissions for SDK calls may be stricter than gcloud invocation
  - Mitigation: implement fallback to gcloud; document required roles in errors.
- Rate limits and transient failures
  - Mitigation: implement simple retries with backoff for SDK calls; bound concurrency for API calls.
- Output parsing brittleness in gcloud fallback
  - Mitigation: restrict to well-structured `--format` output and validate.

## Rollout & Validation
- Keep deploy-cloud.sh unchanged; Phase 2 runs side-by-side.
- Validate locally using `planning/sprint-4-b5a2d1/validate_deliverable.sh`.
- Run `npm run brat -- secrets check --json` in a sandbox project to verify behavior.
- Dry-run `deploy services --all --summarize json` and validate schema.

## Definition of Done (Phase 2)
- New commands implemented with tests and documentation.
- All tests pass; validate_deliverable.sh returns success.
- Packaging boundary preserved; no brat artifacts in service images.
- Request log updated; sprint manifest includes this plan.

## Traceability
- Aligns with: planning/sprint-4-b5a2d1/phase-2-outline.md (Scope items 1–5)
- Architecture references: planning/sprint-4-b5a2d1/architecture-iac-cli.md (Sections 3.2, 3.5, 3.6, 3.8; Phase 2 in Section 5)
- Prompt ID: req-007