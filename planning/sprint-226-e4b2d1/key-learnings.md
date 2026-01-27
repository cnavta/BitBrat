# Key Learnings – sprint-226-e4b2d1

- **Deprecation Checklist:** Always check `architecture.yaml`, `config.ts`, `types/index.ts`, `events.ts`, and routing files (`route.json`) when removing a service.
- **Test Isolation:** Deprecated code should be excluded from active test suites to prevent maintenance overhead on code that is no longer intended to run.
- **Config Cleanup:** Removing unused configuration fields reduces cognitive load and prevents accidental reliance on legacy settings.
