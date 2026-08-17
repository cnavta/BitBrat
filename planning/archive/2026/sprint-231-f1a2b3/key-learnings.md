# Key Learnings – sprint-231-f1a2b3

- **Interactive CLI**: `readline` is sufficient for simple prompts, but for complex flows, a library like `inquirer` or `prompts` would be better (though avoided here to minimize dependencies).
- **Firestore Emulator**: Setting `FIRESTORE_EMULATOR_HOST` programmatically is effective for ensuring scripts target the local environment correctly.
- **Placeholder Replacement**: Rule templates often use inconsistent casing or variable names (e.g., `%BOT_NAME%` vs `%botUsername%`); it's better to provide a mapping of all common variants.
- **CLI Arg Parsing**: Be careful with default values in global arg parsers when specific commands need to distinguish between "not provided" and "using default".
