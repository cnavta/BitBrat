# Execution Plan - Brat Setup Command (sprint-231-f1a2b3)

## Goal
Implement the `setup` command in the `brat` CLI to automate platform initialization.

## Phases

### Phase 1: Foundation & CLI Integration
- Register the `setup` command in the main CLI entry point.
- Create a dedicated `setup.ts` file to house the logic.
- Implement the interactive prompt mechanism using Node.js `readline`.

### Phase 2: Configuration & Persistence
- Implement logic to write collected inputs to local configuration files (`.env.local` and `env/local/secrets.yaml`).
- Ensure appropriate validation of inputs (e.g., non-empty strings).

### Phase 3: Environment Bootstrapping
- Integrate with `deploy-local.sh` to trigger the local environment startup.
- Implement a wait/retry mechanism to ensure the Firestore emulator is available before proceeding.

### Phase 4: Data Import & Placeholder Replacement
- Implement the "personality" document creation.
- Implement the "api-gateway" token generation and storage.
- Implement the rule import logic with `%varname%` replacement.
- Ensure Firestore operations target the local emulator.

### Phase 5: Validation & Finalization
- Create unit tests for utility functions (placeholder replacement, file writing).
- Conduct a full end-to-end manual test of the setup flow.
- Update documentation and complete the sprint protocol.

## Technical Details
- **Firestore Access**: Use `firebase-admin` configured to connect to the emulator (via `FIRESTORE_EMULATOR_HOST`).
- **Placeholder Replacement**: A simple regex-based replacement for `%PROJECT_ID%`, `%OPENAI_API_KEY%`, and `%BOT_NAME%`.
- **Token Generation**: Use `uuid` to generate the initial gateway token.
