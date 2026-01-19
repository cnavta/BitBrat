# Local Execution Assessment – sprint-195-b5a2c1

## Overview
This document assesses the current state of the local execution process (`npm run local`) and identifies gaps that prevent the application from running reliably in a local environment.

## Discovered Gaps

### 1. Missing Service Configuration Files
Several services are missing their corresponding YAML configuration files in `env/local/`. While Docker Compose files exist for these services, the lack of specific environment variable definitions causes them to rely solely on global defaults or fail during the `BaseServer.ensureRequiredEnv` check.

**Affected Services:**
- `auth` (Missing `auth.yaml`)
- `event-router` (Missing `event-router.yaml`)
- `persistence` (Missing `persistence.yaml`)
- `scheduler` (Missing `scheduler.yaml`)

### 2. Required Secrets as Environment Variables
The `BaseServer.ensureRequiredEnv` helper (which reads `architecture.yaml`) strictly enforces that all `env` and `secrets` listed for a service are present in the process environment. Locally, these must be provided via the merged `.env.local` file. Currently, many required secrets are missing from the `env/local/` YAML files.

**Missing Key Secrets:**
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` (Required by `auth`, `ingress-egress`, `oauth-flow`)
- `OPENAI_API_KEY` (Required by `llm-bot`)
- `MCP_AUTH_TOKEN` (Required by `scheduler`, `obs-mcp`)
- `DISCORD_BOT_TOKEN` (Required by `ingress-egress`)
- `TWILIO_ACCOUNT_SID`, etc. (Required by `ingress-egress`)

### 3. Missing `.env.example`
The `README.md` instructs users to copy `.env.example` to `.env`, but no `.env.example` or equivalent template exists in the root directory. This makes it difficult for new developers to know which values to provide in `.secure.local`.

### 4. Dependency on Absolute Path for ADC
The `infrastructure/deploy-local.sh` script and the `firebase-emulator` service in Docker Compose require `GOOGLE_APPLICATION_CREDENTIALS` to be an **absolute path** to a service account JSON file. This is a significant friction point for local setup and should be better documented or made more flexible if possible (though Docker bind mounts usually prefer absolute paths).

### 5. Port Collision Management Complexity
`deploy-local.sh` has a complex auto-assignment logic for ports. While it attempts to be smart, it can lead to non-deterministic port assignments if some ports are explicitly set and others are not, making it harder to know where a service is listening without checking logs.

### 6. Service-Specific Initialization
Some services (like `persistence`) might require specific Firestore collections or indices to be present in the emulator. While `firebase-emulator-bootstrap.sh` exists, its completeness should be verified.

## Recommendations

1. **Create Missing YAML Files**: Add template YAML files for all services in `env/local/` with sensible local defaults.
2. **Provide `.env.example`**: Create a comprehensive `.env.example` (or `.secure.local.example`) that lists all required secrets and local overrides.
3. **Enhance Documentation**: Update `README.md` with clear instructions on how to set up `GOOGLE_APPLICATION_CREDENTIALS` and which secrets are mandatory for a minimal run.
4. **Validation Script**: Ensure `validate_deliverable.sh` can properly detect missing local configuration before attempting to bring up the stack.
