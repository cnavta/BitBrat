# Implementation Plan – sprint-124-f3a1c8

## Objective
- Enforce an environment requirement in the brat CLI so that commands that depend on environment do not run without an explicit environment context. Prevent issues like deploying with the wrong VPC connector by requiring either:
  - An --env flag on the command line, or
  - A BITBRAT_ENV environment variable

## Scope
- In scope
  - Modify tools/brat/src/cli/index.ts to enforce env requirement for specific commands
  - Update CLI help text to clearly mark --env as required for those commands
  - Add friendly error messaging with exit code 2 when env is missing
  - Keep doctor and config commands behavior unchanged; do not require env for them
- Out of scope
  - Changing infrastructure or VPC logic beyond the env enforcement
  - Changing default connectors or regions
  - Broad refactors of CLI argument parsing beyond what’s necessary

## Deliverables
- Code changes
  - Env enforcement and validation in main() for impacted command paths
  - parseArgs: track whether --env was explicitly provided (envExplicit)
  - Help/usage text updates indicating --env is required
- Tests
  - Minimal unit tests for argument parsing and env enforcement behavior (if feasible within current CLI structure)
- Documentation
  - Inline help message updates
- CI/Deployment
  - Ensure validate_deliverable.sh remains logically passable; add a dry-run example call if needed

## Acceptance Criteria
- Running any of the following without --env and without BITBRAT_ENV causes an immediate exit with code 2 and a clear message suggesting --env dev|prod:
  - brat deploy services
  - brat deploy service <name>
  - brat deploy <name>
  - brat infra plan/apply (any module)
  - brat lb urlmap render/import
  - brat apis enable
- The following commands remain usable without env:
  - brat doctor
  - brat config show
  - brat config validate
  - brat trigger create/update/delete
- If BITBRAT_ENV is set (e.g., BITBRAT_ENV=dev), the above commands succeed even without --env
- Help text shows --env as required (or clearly indicated) for affected commands

## Testing Strategy
- Unit tests:
  - parseArgs sets env from --env and captures whether the flag was explicitly provided
  - main() level guard: simulated invocation paths without env produce code 2 and expected message
- Manual validation:
  - Run: npm run brat -- deploy service oauth-flow (expect code 2 + message)
  - Run: BITBRAT_ENV=dev npm run brat -- deploy service oauth-flow (should proceed)
  - Run: npm run brat -- deploy service oauth-flow --env dev (should proceed)

## Deployment Approach
- No cloud deployment changes; this is a local CLI behavior change
- Ensure existing Cloud Build files remain compatible; no change to substitutions other than preventing accidental missing env

## Dependencies
- None new; relies on existing Node/TypeScript & Jest tooling

## Definition of Done
- Code updated with env enforcement and help text
- Tests pass locally
- validate_deliverable.sh remains logically passable
- Changes committed on a feature branch and PR opened per Sprint Protocol v2.4
