### Key Learnings – sprint-131-873b2a

- Normalizing shared fields (like bot.personality) consistently across all match paths avoids subtle feature gaps. Ensure cache layers mirror repository normalization.
- Personality composition belongs in the system prompt and must be resilient to history and reducers; pinning the system message prevents accidental loss under trimming pressure.
- Validation should separate infra-dependent tests from app-layer tests to reduce unrelated noise when verifying feature-level sprints.
- Clear logging around personality resolution (resolved, dropped, clamped, cache hits/misses) made root-causing prompt behavior straightforward.
