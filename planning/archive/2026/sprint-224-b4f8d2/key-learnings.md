# Key Learnings — sprint-224-b4f8d2

- **Mustache logic**: Mustache standardizes property access (e.g., `{{user.displayName}}`), which is highly compatible with the `InternalEventV2` structure.
- **Context Overrides**: Using `{ ...rule.metadata, ...ctx }` is a clean way to implement "event data always overriding metadata" as required by the spec.
- **Shell quoting**: Remember to quote version strings in `npm install` when they contain special characters like `^` to avoid shell expansion errors.
- **Testing dynamic fields**: Regex matching in Jest (e.g., `toMatch`) is useful for verifying fields that contain timestamps or other non-deterministic data.
