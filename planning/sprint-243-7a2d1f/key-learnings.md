# Key Learnings – sprint-243-7a2d1f

- **Personality Overrides:** Providing model and platform overrides at the personality level allows for fine-grained control over which LLM handles specific types of interactions, which is useful for balancing cost and performance.
- **Prompt Metadata:** Including 'platform' in prompt logs is essential for debugging and cost analysis when multiple providers are used.
- **Adaptive Model Selection:** Existing intent-based model selection can be combined with explicit overrides, where explicit overrides take precedence.
- **Test Integrity:** Comprehensive unit tests are vital when refactoring complex processing logic to prevent regressions in feature-rich functions.
