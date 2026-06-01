# Key Learnings - sprint-312-c2e3f4

- **Defensive Population**: When populating databases via CLI tools, always use a testable factory or getter function to verify the structure before it hits the database.
- **Interface Adherence**: In TypeScript projects, explicitly typing local object literals with the target interface (e.g., `RuleDoc[]`) helps catch schema mismatches early.
- **Wipe and Verify**: The interactive 'wipe' feature in setup is critical for testing idempotency and ensuring clean state when schema changes occur.
