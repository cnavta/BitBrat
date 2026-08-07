# Key Learnings – sprint-142-d6e8f1

- Always verify that all services have consistent Dockerfile setups, especially when they depend on shared configuration files like `architecture.yaml`.
- When the architecture schema changes (like adding `resources` under `infrastructure`), use project-wide search to find and update all usages.
- Mocking the architecture YAML in tests can hide schema-related bugs if the mock doesn't match the actual structure.
