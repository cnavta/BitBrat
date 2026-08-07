# Deliverable Verification – sprint-317-a4c7e2

## Completed
- [x] Authored `documentation/tutorials/lurk-command-part-2.md`, continuing exactly where Part 1 ends (recaps the empty-slip/static-candidates ending and changes that part).
- [x] Step 1 — Routing the `!lurk` event to the `llm-bot`:
  - [x] Added a routing slip step (`id: llm-bot`, `nextTopic: internal.llmbot.v1`).
  - [x] Added a `prompt` annotation with value `Generate a random lurk response for ${user.displayName}`.
  - [x] Removed the existing `candidates` / `randomCandidate` enrichments.
  - [x] Documented testing with the default personality first.
- [x] Step 2 — Personalities:
  - [x] Explained the `/personalities` collection (schema, active/version selection).
  - [x] Added a personality document (`documentation/reference/setup/lurk_personality.json`) plus an inline `my-lurk-personality.json` example and upsert command.
  - [x] Updated the rule to add a `personality` annotation attribution (`value: lurk-master`).
- [x] Added a "Next Steps" link from Part 1 → Part 2.
- [x] `validate_deliverable.sh` passes: required files, JSON validity (personality + all 3 embedded rule blocks), internal-link resolution, topic coverage, and Part 1→Part 2 link.
- [x] **REQ-002 amendment** — documented default provider/model assumptions and per-personality overrides in `lurk-command-part-2.md`:
  - [x] Added Step 1d explaining the platform defaults to **OpenAI** (requires `OPENAI_API_KEY`) with the model from `OPENAI_MODEL` (fallback `gpt-4o`).
  - [x] Added `model` and `platform` rows to the personality schema table.
  - [x] Added Step 2e showing how to override `model`/`platform` per personality, plus a troubleshooting bullet and a Summary point.
  - [x] Extended `validate_deliverable.sh` (new link target + topic checks); re-validated, now 4/4 embedded JSON blocks valid.

## Partial
- None.

## Deferred
- [ ] Live end-to-end run of the tutorial against a running platform (requires local emulator + `llm-bot` runtime and credentials). Documentation was validated structurally rather than executed.

## Alignment Notes
- The tutorial uses the existing Part 1 `routing.slip` shape (RoutingStep with `id` + `nextTopic`) for series continuity; the `internal.llmbot.v1` topic and prompt/personality annotation shapes mirror `documentation/reference/setup/bot_mention_rule.json` and `cnj_rule.json`.
- `node` is unavailable in the validation environment; the embedded-JSON-block check falls back gracefully and was independently confirmed via `python3` (3/3 blocks valid).
- Personality schema and selection semantics follow `documentation/llm-bot-personality.md`.

## DoD Check (AGENTS.md – Documentation)
- Rationale/trade-offs documented (why remove candidates; prompt vs. personality). ✓
- Traceable to sprint-317 and REQ-001/REQ-002/REQ-003 in `request-log.md`. ✓
- Validation pipeline (`validate_deliverable.sh`) is logically passable and currently passes. ✓

## Closure (REQ-003)
- Sprint closed by user ("Sprint complete.", Rule S2); `sprint-manifest.yaml` status set to `complete`.
- PR auto-creation remained blocked (no `gh`/`GITHUB_TOKEN`); failed attempt logged in `publication.yaml`, manual PR required against `main` (Rule S13b, accepted by user).
