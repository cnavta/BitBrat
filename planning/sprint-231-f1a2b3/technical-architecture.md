# Technical Architecture: Brat Setup Command

## Objective
Provide a seamless onboarding experience for new developers and users by automating the initial configuration of the BitBrat platform through a single command: `npm run brat -- setup`.

## Overview
The `setup` command will guide the user through a series of interactive prompts to collect essential configuration data, generate necessary environment/secrets files, and bootstrap a local environment with pre-populated Firestore data.

## Requirements
- Interactive CLI prompt for:
    - GCP Project ID
    - OpenAI API Key
    - Bot Name
- Populate local secrets/env files.
- Bootstrap local environment (start emulators).
- Pre-populate Firestore artifacts:
    - Initial `api-gateway` token.
    - Basic `personality` named after the bot.
    - Import rules from `documentation/reference/setup/`, replacing `%varname%` placeholders.
- Target the Firestore emulator initially.

## Architecture

### 1. Interactive Prompts
Use the built-in Node.js `readline` module or a lightweight library (if already in `package.json`) to collect user input.
- `GCP_PROJECT_ID`: Used for cloud interaction and locally as an identifier.
- `OPENAI_API_KEY`: Required for the `llm-bot-service`.
- `BOT_NAME`: Used for the personality and bot identification.

### 2. Configuration Persistence
The collected information will be written to:
- `.env.local`: For general environment variables.
- `env/local/secrets.yaml` (or similar): For sensitive data like the OpenAI key, following existing patterns in `tools/brat/src/config/loader.ts`.

### 3. Local Environment Bootstrapping
Trigger `./infrastructure/deploy-local.sh` to start the local Docker Compose environment, specifically the Firebase emulator.

### 4. Firestore Data Population
Once the emulators are healthy, a script will:
- Generate a UUID for the `api-gateway` token and write it to Firestore (`tokens` collection).
- Create a `personality` document in Firestore (`personalities` collection) with the provided `BOT_NAME`.
- Read all JSON files in `documentation/reference/setup/`.
- For each file:
    - Replace `%BOT_NAME%`, `%PROJECT_ID%`, etc., with the collected values.
    - Upsert the document into the `rules` collection in Firestore.

### 5. Integration with `brat` CLI
- New command `setup` in `tools/brat/src/cli/index.ts`.
- Implementation logic in `tools/brat/src/cli/setup.ts`.

## Data Flow
1. User runs `npm run brat -- setup`.
2. CLI collects inputs.
3. CLI writes `.env.local` and secrets.
4. CLI executes `./infrastructure/deploy-local.sh`.
5. CLI waits for Firestore emulator to be ready.
6. CLI performs Firestore data import (Tokens -> Personality -> Rules).
7. CLI reports success and provides next steps.

## Security Considerations
- Ensure the OpenAI key is stored in a file that is ignored by git (e.g., `.env.local` or a specific secrets file).
- The `api-gateway` token generated should be displayed to the user for immediate use in testing the `brat chat`.
