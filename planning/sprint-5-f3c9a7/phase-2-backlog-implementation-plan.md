# Phase 2 Backlog Implementation Plan — SDK Migration & Trigger Management

Sprint: sprint-5-f3c9a7
Owner: Lead Implementor
Status: Proposed (awaiting approval)
Source of Truth: architecture.yaml
Related Docs:
- planning/sprint-4-b5a2d1/verification-report.md (§Partial, lines 24–25)
- planning/sprint-5-f3c9a7/implementation-plan.md (§Work Breakdown, items 5 and 6)

## Objective & Scope
Complete the Phase 2 backlog by migrating critical GCP interactions in the brat CLI to official Google Cloud SDKs (with controlled gcloud fallbacks) and delivering trigger management commands.

In scope:
- SDK adapters (Node.js) for:
  - Secret Manager — resolve secrets to ENABLED numeric versions
  - Cloud Build — submit builds; create/update/delete triggers
  - Cloud Run — describe service for deploy validation and backend mapping
- CLI trigger commands: `brat trigger create|update|delete`
- Unit tests with Jest for all new adapters and commands
- Non-destructive behavior with `--dry-run` support

Out of scope:
- Creating or importing new secrets (policy remains: verify/resolve only)
- Changing current deployment substitutions contract

## Deliverables
- Code:
  - tools/brat/src/providers/gcp/secrets.ts (SDK-first resolution)
  - tools/brat/src/providers/gcp/cloudbuild.ts (SDK-first build submit + triggers API)
  - tools/brat/src/providers/gcp/cloudrun.ts (service describe)
  - tools/brat/src/cli/commands/trigger/{create,update,delete}.ts or integrated into current CLI entry while preserving minimal footprint
- Tests:
  - *.spec.ts covering adapter behaviors (success, not found, permission errors, dry-run)
  - CLI command tests for argument parsing and provider invocation
- Docs:
  - Update planning docs with rationale, usage examples, and failure modes
- Validation:
  - validate_deliverable.sh unchanged (already runs build+tests); tests must pass

## Acceptance Criteria
- Secret Manager adapter resolves mappings like `FOO=FOO:latest;BAR=BAR:3` to numeric versions for ENABLED versions only; hard-fail (non-dry-run) on missing/disabled.
- Cloud Build adapter:
  - Submits builds equivalent to current behavior (substitutions preserved)
  - Manages triggers: create, update (idempotent), delete by name
- Trigger CLI commands:
  - `brat trigger create --name <n> --repo <r> --branch <b> --config <path>` creates if missing or no-ops if identical
  - `brat trigger update ...` updates changed fields
  - `brat trigger delete --name <n>` deletes if exists; no-op otherwise
- Cloud Run adapter can `describe` a service for validation hooks
- `--dry-run` prints intended actions without calling mutating SDK methods
- All new code has Jest unit coverage; root validation script passes fully

## Testing Strategy
- Unit tests mock official clients (@google-cloud/*) and verify:
  - Proper request construction
  - Error classification (not found, permission denied, invalid argument)
  - Dry-run behavior
- CLI tests validate flag parsing and provider wiring
- No live calls; all external interactions mocked

## Deployment Approach
- No runtime deployment is required for this backlog; changes affect the CLI only
- Maintain packaging boundary: brat remains a standalone administrative CLI and is not bundled into service images

## Definition of Done (DoD)
- SDK adapters implemented with tests and used by CLI in non-destructive flows
- Trigger commands available with help text and dry-run
- validate_deliverable.sh passes (npm ci, build, test)
- Documentation updated in planning with examples and traceability

## Work Breakdown
1. Secret Manager Adapter
   - Implement resolve-to-numeric logic with ENABLED filter and pagination handling
   - Add retries and error classification
   - Unit tests for: latest, pinned version, missing, disabled
2. Cloud Build Adapter — Builds
   - Implement build submit via SDK; preserve existing substitutions contract
   - Stream logs through existing exec harness if SDK streaming is unavailable; otherwise poll build status
   - Unit tests for request construction and status handling
3. Cloud Build Adapter — Triggers
   - Implement get/create/update/delete by name
   - Support basic filters: repo source (GitHub/Cloud Source), branch regex, substitutions, config path
   - Unit tests for idempotency and diff/apply logic
4. Cloud Run Adapter — Describe
   - Implement service describe (region-aware)
   - Unit tests for response parsing and not-found
5. CLI Trigger Commands
   - Wire create|update|delete into CLI with `--dry-run` support
   - Help text and examples
   - Unit tests for arg parsing and provider invocation
6. Documentation & Examples
   - Add usage examples under planning with typical flags
   - Update request-log and verification notes

## Risks & Mitigations
- SDK capability gaps → retain gcloud fallback with strict parsing via exec harness
- IAM permissions in developer environments → clear error messages and `doctor` checks
- Trigger schema drift across sources → minimize scope to repo+branch regex and substitutions

## Traceability
- Addresses backlog items:
  - sprint-4-b5a2d1/verification-report.md — lines 24–25
- Aligns with command taxonomy in architecture-iac-cli.md (§3.2, trigger commands)
