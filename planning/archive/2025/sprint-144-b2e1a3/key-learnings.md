# Key Learnings – sprint-144-b2e1a3

- **Feature Toggle Synergy**: Having `DISCORD_ALLOW_ENV_FALLBACK` already in place allowed for a very smooth transition back to env-based tokens.
- **Architecture Validation**: `BaseServer.computeRequiredKeysFromArchitecture` is a powerful tool to ensure that all services have the necessary secrets before they even start.
