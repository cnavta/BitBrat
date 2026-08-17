# Request Log - sprint-311-b4f2c8

## [2026-05-31T14:32:00Z] - Fix logic serialization
- **Prompt Summary**: Fix 'logic' property in brat setup to be serialized JSON.
- **Interpretation**: The `logic` field in routing rules should be a string, not an object. Also needs to align with `RuleDoc` schema.
- **Actions**:
  - Start sprint 311.
  - Modify `tools/brat/src/cli/setup.ts`.
