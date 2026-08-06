# Key Learnings – sprint-157-8d2f3a

- **Fire-and-Forget Pattern**: When implementing auxiliary services like logging, using the fire-and-forget pattern (catching errors and not awaiting) is essential to preserve the availability and performance of the primary service.
- **Mocking Strategy**: For services that use `getFirestore()`, mocking the entire module or the return value of the function is necessary to avoid trying to initialize the actual Firebase Admin SDK in tests.
- **Redaction by Default**: Even when the requirement is to capture "full text", applying project-standard redaction should be the default behavior to protect PII unless explicitly told otherwise.
