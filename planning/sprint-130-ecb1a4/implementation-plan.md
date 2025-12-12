# Implementation Plan – sprint-130-ecb1a4

## Objective
- Treat env vars defined in architecture.yaml as required keys only. Include all env vars from the selected environment overlay in Cloud Run deployments, excluding those provided via Secret Manager.
- Provide BaseServer convenience accessors for config/env: getConfig<T>(ENV_NAME) and getSecret<T>(ENV_NAME) to reduce direct process.env usage in services.
- Introduce BaseServer.CONFIG_DEFAULTS for subclass-defined configuration defaults that getConfig(name) will honor when env is absent.

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
- Code changes in src/common/base-server.ts adding getConfig<T>() and getSecret<T>() helpers
- Code changes in src/common/base-server.ts adding protected static CONFIG_DEFAULTS and getConfig() fallback behavior
- Planning artifacts in planning/sprint-130-ecb1a4
- Validation via existing validate_deliverable.sh

## Acceptance Criteria
- Deploy steps use all overlay env vars (visible in logs as env keys to set), not just those declared in architecture.yaml.
- Missing required env keys (from architecture.yaml) cause an error in apply mode and a warning in dry-run.
- Secrets remain excluded from plain env vars and are supplied via SECRET_SET_ARG mapping.
- Build and tests pass.
- BaseServer exposes getConfig<T>(name, opts?) and getSecret<T>(name, opts?) that:
  - Return parsed env value with optional parser
  - Throw when required and missing; honor provided default
  - Are typed as protected for the single-value overloads
  - Obey subclass defaults via BaseServer.CONFIG_DEFAULTS when env var is not present and no explicit default is provided

## Testing Strategy
- Run npm build and tests.
- Dry-run deploy to observe log lines showing full env key set and required-key validation behavior.
- Add/extend unit tests in later sprint to cover BaseServer getters (this sprint: rely on compilation and existing tests only).

## Deployment Approach
- No infrastructure changes. Behavioral change in deploy tooling only.

## Dependencies
- None new. Uses existing Node and bash tooling.

## Definition of Done
- Code merged via PR with green CI, planning artifacts updated, and validation script logically passable.
