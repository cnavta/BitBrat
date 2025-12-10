# Deliverable Verification – sprint-123-a2f701b

## Completed
- [x] STM-001 – Messages reducer implemented with count/char trimming; exported for tests
- [x] STM-002 – ingest_prompt node builds user messages from annotations; early SKIP when none
- [x] STM-003 – call_model flattens messages; appends Assistant message; detailed logs
- [x] STM-004 – build_candidate produces text candidate from assistant reply
- [x] STM-006 – Unit tests for reducer
- [x] STM-007 – Unit tests for processor (happy/skip/error)
- [x] STM-008 – Observability logs for memory ops
- [x] STM-005 – Env knobs documented and wired (architecture.yaml + plan)
- [x] STM-009 – validate_deliverable.sh aligned; supports running tests without PROJECT_ID and adds --scope llm-bot
- [x] STM-010 – Planning docs updated with env notes
- [x] STM-011 – InstanceMemoryStore added with TTL/LRU and per-key bounds
- [x] STM-012 – Processor integration loads prior turns and appends user/assistant
- [x] STM-013 – Store unit tests (trim, TTL, LRU, concurrency)
- [x] STM-014 – Processor cross-event tests using instance store
- [x] STM-015 – architecture.yaml updated with LLM_BOT_INSTANCE_MEM_* env vars
- [x] STM-016 – Warnings and debug logs for instance memory read/append
- [x] STM-018 – Validation: ./validate_deliverable.sh --scope llm-bot passes locally

## Partial
- [ ] Full repository validation (all stacks) via validate_deliverable.sh without PROJECT_ID – deferred to CI/infra context; llm-bot scope passes locally

## Deferred
- STM-017 – Planning/docs update for instance memory (will finalize after PR review)

## Alignment Notes
- No changes to llm-bot service entrypoint required; processor orchestrates LangGraph nodes.
- Added env vars to architecture.yaml for short-term memory bounds and optional system prompt.
- validate_deliverable.sh now tolerates missing PROJECT_ID (skips infra/deploy) and supports scoped tests for llm-bot.