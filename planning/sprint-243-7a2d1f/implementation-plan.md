# Execution Plan - sprint-243-7a2d1f

## Objective
Enhance platform flexibility by adding platform/model overrides to personalities, improving query analysis accuracy, and tracking platform metadata in prompt logs.

## Scope
- **Query Analyzer:** System prompt optimization and platform tracking in logs.
- **LLM Bot:** Personality-based model/platform overrides and platform tracking in logs.
- **Personality Resolver:** Schema updates for `platform` and `model` properties.

## Deliverables
- Improved system prompt for Query Analyzer.
- Updated `PersonalityDoc` and `ResolvedPersonality` interfaces.
- Updated `resolvePersonalityParts` logic.
- Model/Platform override logic in `llm-bot/processor.ts`.
- `platform` field in `prompt_logs` for both services.
- Validation script and test coverage.

## Acceptance Criteria
- Query Analyzer prompt is more descriptive and accurate.
- `prompt_logs` in Firestore contain the `platform` field for both services.
- LLM Bot correctly switches model/platform if a personality specifies them.
- Existing functionality remains intact (regression testing).

## Testing Strategy
- Unit tests for `resolvePersonalityParts` with new fields.
- Unit tests for `llm-bot/processor` to verify override logic.
- Manual verification of Firestore logs.

## Deployment Approach
- Cloud Run deployment (simulated via dry-run).

## Dependencies
- Firestore access for logs and personalities.

## Definition of Done
- All code changes implemented and tested.
- `validate_deliverable.sh` passes.
- PR created and linked.
- Verification report and retro completed.
