# Implementation Plan - sprint-231-f1a2b3

## Objective
Implement `npm run brat -- setup` to automate initial platform configuration.

## Scope
- Interactive CLI for setup data collection.
- Local configuration file generation.
- Local environment (emulator) startup.
- Firestore data population (tokens, personality, rules).

## Deliverables
- `tools/brat/src/cli/setup.ts`: Implementation of the setup command.
- Modification to `tools/brat/src/cli/index.ts` to register the `setup` command.
- `validate_deliverable.sh`: Updated to include setup command validation.

## Acceptance Criteria
- Running `npm run brat -- setup` (mocking input if needed) successfully:
    - Generates `.env.local` or equivalent.
    - Starts the local environment.
    - Populates Firestore emulator with required documents.
- The `api-gateway` becomes functional for `brat chat` after setup.
- Placeholders in rules are correctly replaced.

## Testing Strategy
- Unit tests for placeholder replacement logic.
- Integration test for the `setup` command flow (using mocks for external shell calls).
- Manual verification of Firestore data.

## Definition of Done
- Code implemented and linted.
- Tests passing.
- `validate_deliverable.sh` successful.
- PR created.

## Task Breakdown
1. [ ] Create `tools/brat/src/cli/setup.ts` skeleton.
2. [ ] Implement interactive prompt logic.
3. [ ] Implement configuration file writing.
4. [ ] Implement shell execution for `deploy-local.sh`.
5. [ ] Implement Firestore data import logic.
6. [ ] Integrate `setup` command into `tools/brat/src/cli/index.ts`.
7. [ ] Verify and validate.
