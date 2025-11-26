# Phase 2 Outline — brat CLI

Sprint: sprint-4-b5a2d1
Role: Lead Implementor
Source of Truth: architecture.yaml

Objective
- Extend brat with deeper parity and observability: secrets checks, richer concurrency reporting, trigger management, and initial SDK migration.

Scope (Phase 2)
1. Secrets Command Enhancements
   - `brat secrets check [--project-id --env] [--services name...]`:
     - Verify that all secrets declared in architecture.yaml for the selected services exist in Secret Manager and have at least one ENABLED version.
     - Output a summary table and JSON with missing/disabled states; non-zero exit if any are missing/disabled.
   - `brat secrets resolve` improvements:
     - Add `--format` option to emit KV, mapping, or JSON forms; surface explicit warnings when multiple ENABLED versions exist.

2. Concurrency & Summaries
   - Enrich per-task logs with start/end timestamps and durations.
   - Emit an aggregate summary: total, succeeded, failed, skipped, dry-run, and per-service timings.
   - Add `--summarize json|table` flag to `deploy services`.

3. Trigger Management
   - Add `brat trigger create|update|delete` with options:
     - `--github-connection`, `--github-repo`, `--branch`, `--cb-location`, `--build-sa`.
   - Prefer Google Cloud Build Node SDK when feasible; fallback to `gcloud` via exec with strict parsing.
   - Idempotent behavior: create if missing, update if present.

4. SDK Migration (initial targets)
   - Implement Google Secret Manager SDK for `secrets resolve|check`.
   - Introduce Cloud Build SDK for describing builds; keep submit via gcloud for now.
   - Add Cloud Run Admin SDK utility for later service state inspections (no deployment in Phase 2).

5. Logging and Error Model
   - Standardize error objects and exit codes across commands.
   - Add runId propagation and command-specific context fields.

6. Tests
   - Unit tests for new commands and summary generators.
   - Mock SDK calls; add snapshot tests for summaries.

Acceptance Criteria
- `brat secrets check` exits non-zero when any required secret is missing or lacks an ENABLED version.
- `deploy services` prints an end-of-run summary; JSON summary available via flag and consumed by CI.
- Trigger commands perform idempotent operations with clear logs; dry-run previews actions.
- SDK-based secrets resolution implemented with fallback to gcloud behind a feature flag.
- All tests pass and validate_deliverable.sh remains green.
