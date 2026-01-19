# Key Learnings – sprint-195-b5a2c1

- **Global vs Service-Specific Env**: In a multi-service monorepo where services share a generated `.env` file, it is critical not to include service-specific identifiers (like `SERVICE_NAME`) in the global scope.
- **Strict Validation in BaseServer**: The automated environment validation in `BaseServer` is a double-edged sword: it prevents misconfigured services from starting, but it also makes local setup more rigid, requiring all "secrets" to be present even if they aren't used for a particular test run.
- **Docker Path Handling**: Absolute paths for `GOOGLE_APPLICATION_CREDENTIALS` remain the most reliable way to handle ADC in a dockerized local environment, but they require explicit documentation for developers.
