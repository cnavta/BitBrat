# Sprint Retrospective – sprint-252-d8f9a2

## What Worked Well
- The centralization of provider logic immediately simplified the services.
- Using a factory pattern made it trivial to add vLLM support without changing any core logic in the services.
- Standardizing environment variables across services makes the configuration much more predictable.

## Challenges & Solutions
- **Existing Test Failures**: Refactoring the `query-analyzer` caused existing tests to fail because they were tightly coupled to the old local implementation of `getLlmProvider`.
  - *Solution*: Updated the existing tests to import the factory and correctly mock the new dependencies (`createOpenAI` instead of `openai`).
- **Backward Compatibility**: `llm-bot` had unique variable names.
  - *Solution*: Implemented a fallback mechanism in the configuration loading to support both old and new names, ensuring a smooth transition.

## Lessons Learned
- When refactoring core utilities, always check for service-level tests that might have implemented their own mocks or had dependencies on the internal structure of the service.
- Standardizing environment variables early saves significant effort in multi-service platforms.
