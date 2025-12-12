# Implementation Plan – sprint-130-ecb1a4

## Objective
- Treat env vars defined in architecture.yaml as required keys only. Include all env vars from the selected environment overlay in Cloud Run deployments, excluding those provided via Secret Manager.

## Scope
- In scope:
  - Update brat CLI deploy path to include all overlay env vars and validate required keys.
  - Update infrastructure/deploy-cloud.sh multi-service path similarly.
  - Maintain secret handling: secrets map to Secret Manager and are excluded from plain env.
- Out of scope:
  - Changes to architecture.yaml schema beyond semantics of env lists.
  - Secret Manager provisioning.

## Deliverables
- Code changes in tools/brat/src/cli/index.ts and infrastructure/deploy-cloud.sh
- Planning artifacts in planning/sprint-130-ecb1a4
- Validation via existing validate_deliverable.sh

## Acceptance Criteria
- Deploy steps use all overlay env vars (visible in logs as env keys to set), not just those declared in architecture.yaml.
- Missing required env keys (from architecture.yaml) cause an error in apply mode and a warning in dry-run.
- Secrets remain excluded from plain env vars and are supplied via SECRET_SET_ARG mapping.
- Build and tests pass.

## Testing Strategy
- Run npm build and tests.
- Dry-run deploy to observe log lines showing full env key set and required-key validation behavior.

## Deployment Approach
- No infrastructure changes. Behavioral change in deploy tooling only.

## Dependencies
- None new. Uses existing Node and bash tooling.

## Definition of Done
- Code merged via PR with green CI, planning artifacts updated, and validation script logically passable.
