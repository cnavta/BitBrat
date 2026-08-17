# Retro – sprint-246-e5f6g7

## What worked
- Quick implementation of token filtering.
- `js-tiktoken` integration was straightforward.
- Tests clearly demonstrated the skip logic.

## What didn't work
- Initial plan used a regex heuristic; user correctly identified that `tiktoken` should be used for better accuracy.

## Learnings
- Always check for the most accurate way to measure LLM-related metrics (tokens) rather than using proxies if possible.
- `js-tiktoken` is a lightweight way to get accurate counts without WASM overhead if preferred.
