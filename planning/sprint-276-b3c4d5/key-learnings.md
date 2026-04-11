# Key Learnings – sprint-276-b3c4d5

- Configuration flags that control source-of-truth selection (e.g., `discordUseTokenStore`) should always be accompanied by validation checks to ensure all required fields for that mode are present.
- `assertRequiredSecrets` should be kept in sync with all integrations to provide fail-fast behavior during startup.
