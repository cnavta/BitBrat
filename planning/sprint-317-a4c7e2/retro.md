# Retro – sprint-317-a4c7e2

## What worked
- Reusing existing reference rules (`bot_mention_rule.json`, `cnj_rule.json`) gave authoritative, copy-pasteable syntax for prompt/personality annotations and the `internal.llmbot.v1` routing target, keeping the tutorial accurate.
- The existing `llm-bot-personality.md` provided a ready schema for the `/personalities` explanation, avoiding invented fields.
- Keeping Part 2's rule in the same `routing.slip` shape as Part 1 made the "start exactly where Part 1 ends" requirement natural.

## What didn't / friction
- `node` is unavailable in the validation environment, so the embedded-JSON-block check in `validate_deliverable.sh` is skipped; coverage was preserved by a `python3` fallback for files and a manual python pass for embedded blocks.
- The repo mixes `routing.slip` (tutorial) and top-level `routingSlip` (reference setup rules); chose the tutorial's `routing.slip` form for series continuity and noted it in the verification report.

## Follow-ups
- Consider a live end-to-end pass of the tutorial against a running local platform + `llm-bot` (deferred; needs runtime + credentials).
- Optionally reconcile `routing.slip` vs `routingSlip` naming across docs in a future docs-cleanup sprint.

## Publication note
- See `publication.yaml` for PR status. If `gh`/GITHUB_TOKEN are unavailable in this environment, the PR must be opened manually from the feature branch.

## Closure
- Sprint closed by user ("Sprint complete.", Rule S2) after REQ-001 + REQ-002 were delivered and validation was logically passable. Auto-PR creation remained blocked (no `gh`/`GITHUB_TOKEN`); the failed attempt is logged in `publication.yaml` and the manual PR URL must be opened against `main` (Rule S13b).
