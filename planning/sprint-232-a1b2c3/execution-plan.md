# Execution Plan - Brat Setup Re-run Warning (sprint-232-a1b2c3)

## Goal
Implement a safety check in `brat setup` to warn users if they are about to overwrite an existing configuration.

## Phases

### Phase 1: Research & Design
- Identify all markers that indicate an existing setup.
- Design the user interaction flow (Warning message + Y/N prompt).

### Phase 2: Implementation
- Implement `isAlreadyInitialized()` helper in `setup.ts`.
- Integrate the check at the start of `cmdSetup`.
- Implement the confirmation logic.

### Phase 3: Testing
- Update `tools/brat/src/cli/setup.test.ts` to cover the new logic.
- Mock `fs.existsSync` and `readline` to simulate existing/missing configurations and user input.

### Phase 4: Validation
- Run end-to-end manual tests.
- Verify that `--project-id` or other flags still work (or if they should bypass the warning).
- Ensure the setup command still works from scratch.
