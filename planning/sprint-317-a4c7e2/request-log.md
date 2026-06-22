# Request Log – sprint-317-a4c7e2

## REQ-001 — 2026-06-22T17:09Z — Sprint kickoff
- **Prompt summary**: "We are starting a new sprint. Assume the role of lead technical writer. Add a Part 2 to the existing !lurk tutorial that introduces routing to the llm-bot, personalities and prompt annotations. It should start exactly where the initial !lurk tutorial ends. Change the routing doc to add the llm-bot to the routing slip and a prompt annotation ('Generate a random lurk response for ${user.displayName}'), remove the existing candidate enrichments, then test with default personality. Next, add a personality: explain the personalities collection and add a doc, then update the !lurk routing doc to add a personality attribution. Plan and execute."
- **Interpretation**: Documentation-only sprint. Produce a Part 2 tutorial continuing from `documentation/tutorials/lurk-command.md`, plus a personality seed example, and a forward link from Part 1. "Plan and execute" is treated as the planning approval gate.
- **Commands executed**:
  - `git checkout -b feature/sprint-317-a4c7e2-lurk-tutorial-part-2`
  - `mkdir -p planning/sprint-317-a4c7e2`
- **Files created/modified**:
  - `planning/sprint-317-a4c7e2/sprint-manifest.yaml`
  - `planning/sprint-317-a4c7e2/implementation-plan.md`
  - `planning/sprint-317-a4c7e2/request-log.md`
  - `documentation/tutorials/lurk-command-part-2.md` (REQ-001)
  - `documentation/reference/setup/lurk_personality.json` (REQ-001)
  - `documentation/tutorials/lurk-command.md` (REQ-001: added "Next" link)
- **Grounding references** (existing repo syntax used in the tutorial):
  - Prompt/personality annotations: `documentation/reference/setup/bot_mention_rule.json`, `documentation/reference/setup/cnj_rule.json`
  - llm-bot routing target: `nextTopic: internal.llmbot.v1`, slip `id: llm-bot`
  - Personalities collection/schema: `documentation/llm-bot-personality.md`
  - Upsert tooling: `documentation/tools/firestore-upsert.md`

## REQ-002 — 2026-06-22T17:24Z — Amendment: document default model/provider + per-personality override
- **Prompt summary**: "Update the part 2 tutorial to include information about the default model and provider assumptions in the platform (OpenAI, need the OPENAI_API_KEY) as well as mentioning the ability to change them per personality."
- **Interpretation**: Amend the active sprint-317 (Rule S4 / §2.4.1). Documentation-only change to `documentation/tutorials/lurk-command-part-2.md`: explain that the platform defaults to OpenAI and requires `OPENAI_API_KEY` (default model via `OPENAI_MODEL`), and document the optional per-personality `model`/`platform` overrides. No code or runtime changes.
- **Grounding references** (verified in source):
  - `src/services/llm-bot/processor.ts` lines 637–638 (model/provider defaults: `OPENAI_MODEL` → `gpt-4o`; `LLM_PROVIDER`/`LLM_PLATFORM` → `openai`) and 644–648 (personality `model`/`platform` override).
  - `src/services/llm-bot/personality-resolver.ts` (`PersonalityDoc.platform`, `PersonalityDoc.model`; `ResolvedPersonality.platform`/`model`).
  - `architecture.yaml` lines 159–162 (`OPENAI_API_KEY` secret, `OPENAI_MODEL` env).
  - `documentation/services/llm-bot.md` Configuration table (`OPENAI_MODEL` default `gpt-4o`, `OPENAI_API_KEY`).
- **Files modified**:
  - `documentation/tutorials/lurk-command-part-2.md` (REQ-002: Step 1d, schema `model`/`platform` rows, Step 2e, troubleshooting bullet, Summary point)
  - `planning/sprint-317-a4c7e2/request-log.md`

## REQ-003 — 2026-06-22T17:28Z — Sprint completion
- **Prompt summary**: "Sprint complete."
- **Interpretation**: User explicitly closes sprint-317 (Rule S2). All deliverables (REQ-001 + REQ-002) done, `validate_deliverable.sh` logically passable, branch pushed (commit `90b046c`). Per Rule S13(b), the failed auto-PR attempt is logged in `publication.yaml` and the user's "Sprint complete." constitutes explicit acceptance of closure with the PR opened manually.
- **Actions**: Set `sprint-manifest.yaml` status to `complete`; retained `retro.md` and `key-learnings.md`.
- **Files modified**:
  - `planning/sprint-317-a4c7e2/sprint-manifest.yaml`
  - `planning/sprint-317-a4c7e2/request-log.md`
