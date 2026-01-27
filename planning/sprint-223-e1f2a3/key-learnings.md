# Key Learnings – sprint-223-e1f2a3

## Technical Learnings
- **Async Engine Patterns**: Refactoring a core synchronous engine to be asynchronous (to support state/DB lookups) requires a comprehensive update of the entire call chain and associated test suites. This should be accounted for in effort estimation.
- **Firestore State Persistence**: Using a specific document path `users/{userId}/routerState/{ruleId}` for per-rule/per-user state provides a clean way to handle randomization history without cluttering the main event or user documents.
- **RuleLoader Schema Evolution**: Using a consolidated `enrichments` object makes the `RuleDoc` cleaner and more extensible for future enrichment types (e.g., dynamic lookups, external API calls).

## Process Learnings
- **Phased Testing**: Running `validate_deliverable.sh` early and often caught integration issues before they became blockers.
- **Regression Monitoring**: Changes to core data structures (`RuleDoc`) will inevitably break legacy tests that depend on exact object shapes. Maintaining a small amount of backward compatibility logic in the loader while updating tests is a balanced approach.
