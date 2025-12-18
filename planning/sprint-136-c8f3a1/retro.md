# Sprint Retro – sprint-136-c8f3a1

## What went well
- Prompt Assembly adoption in llm-bot was straightforward thanks to clear types and adapters.
- Hard cutover reduced long-term tech debt; no dual paths to maintain.
- Observability additions (assembly meta, previews, adapter payload stats) made debugging safer and easier without leaking secrets.
- Validation script now includes practical smoke checks for the assembler and adapters.

## What didn’t go well
- A few tests initially expected legacy flattened formatting; needed updates to align with canonical sections and adapter mapping.
- PR creation depends on GitHub credentials in the current environment; this can block publication in automated runs.

## Improvements for next time
- Add token estimation utilities and structured output validation (JSON Schema) to reduce model output ambiguity.
- Expand adapter test coverage to include Google path goldens and larger truncation scenarios.
- Standardize logging preview limits across services for consistency.
