# Key Learnings – sprint-130-ecb1a4

- Treating architecture.yaml env as “required” while passing through all overlay vars simplifies configuration and reduces drift between environments.
- Centralizing env access in BaseServer reduces duplicated checks and improves error messaging across services.
- Infrastructure-related Jest tests can be brittle without real project context; consider isolating them as integration tests or providing better mocks.