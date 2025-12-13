### Sprint Retro – sprint-131-873b2a

What went well
- Personality annotation feature integrated cleanly into command-processor with minimal surface area.
- Regex cache normalization updated to carry bot.personality, unifying behavior across match paths.
- LLM-bot prompt flow improved: system/personalities always included and protected during trimming.
- Comprehensive unit tests added; command and LLM layers verified.

What could be improved
- Personality de-duplication in resolver is still an optimization opportunity to reduce prompt repetition.
- One unrelated infra provider test failed during full validation; consider isolating infra tests or marking as flaky if environment-dependent.

Actions for future sprints
- Implement personality name-based deduplication in resolver with tests.
- Add end-to-end integration test asserting single system prompt presence under extreme trimming.