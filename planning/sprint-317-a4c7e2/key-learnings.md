# Key Learnings – sprint-317-a4c7e2

- **LLM routing target**: To hand an event to the `llm-bot`, add a routing slip step pointing at the `internal.llmbot.v1` topic (`id: llm-bot`). This is the canonical pattern used by `bot_mention_rule.json` and `cnj_rule.json`.
- **Annotations drive the bot**: A `prompt` annotation (`kind: "prompt"`, `value: <instruction>`) tells the bot *what* to generate; a `personality` annotation (`kind: "personality"`, `value: <personality name>`) tells it *how* to sound.
- **Prompt vs candidates are mutually exclusive in practice**: Leaving static `candidates`/`randomCandidate` alongside an LLM route can short-circuit delivery; remove candidates when routing to the bot.
- **Personalities collection**: `/personalities` documents are selected by `name` + `status == "active"`, latest `version` wins — so versioning enables safe iterative updates without deletes.
- **Seeding**: `npm run firestore:upsert -- personalities @file.json --id <id>` loads a personality; the doc ID is cosmetic since lookup is by `name`.
- **Tooling caveat**: `node` may be absent in the validation environment; doc validation scripts should degrade gracefully (e.g., `python3` JSON fallback) to remain logically passable.
