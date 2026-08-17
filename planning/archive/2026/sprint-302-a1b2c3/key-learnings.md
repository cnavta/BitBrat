# Key Learnings – sprint-302-a1b2c3

- **Annotation Types:** New annotation kinds must be registered in `AnnotationKindV1` and added to the relevant filter logic in `processor.ts`.
- **Adventure Command:** The adventure command relies on 'instruction' annotations to pass system prompts to the LLM. If these are missing, the bot loses its narrator persona.
- **Testing:** Unit tests that capture the final generated prompt (via `callLLM` mock) are highly effective for verifying prompt assembly logic.
