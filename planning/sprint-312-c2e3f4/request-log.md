# Request Log - sprint-312-c2e3f4

## [2026-05-31T14:47:00Z] - Fix RuleDoc schema issues
- **Prompt Summary**: Investigate and fix issues where `brat setup` still uses `routingSlip` and doesn't set stage correctly in `RuleDoc`.
- **Interpretation**: Even after the previous fix, the user reports `routingSlip` is still present. Need to verify all rules and ensure the structure matches `RuleDoc` perfectly, including `enrichments`.
- **Actions**:
  - Initialize sprint 312.
  - Audit `tools/brat/src/cli/setup.ts`.
  - Fix rules and add `enrichments`.
