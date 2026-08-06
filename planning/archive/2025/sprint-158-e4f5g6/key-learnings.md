# Key Learnings – sprint-158-e4f5g6

## Prompt Assembly Strategy
- When rendering history sections alongside active input sections, it is critical to keep them mutually exclusive to avoid redundancy.
- Redundancy in LLM prompts consumes unnecessary tokens and can occasionally cause the model to repeat itself or get stuck in cycles.

## Environment Management
- When merging branches that might include new dependencies, always run `npm install` before validating tests to avoid confusing module-not-found errors.
