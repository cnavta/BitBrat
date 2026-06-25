# Retrospective – sprint-322-ca67dd

## What worked

- **Grounding before writing.** Confirming every cited doc (`platform-flow.md`, `messaging-system.md`,
  the JSON schemas, `firestore.rules/indexes`) up front meant every added description reflected real
  behavior, not invention.
- **Additive-first discipline.** New top-level blocks (`messaging`, `dataflow`, `conventions`,
  `references`, `networking`) and per-service tags were added without renaming/removing consumed fields,
  so the file stayed structurally backward-compatible. The only data change was the approved route removal.
- **A real, runnable validator.** `validate_deliverable.sh` enforces the topic catalog ⊇
  `publishes`/`consumes`, checks LB targets, and verifies references resolve — turning "still valid YAML"
  into an executable gate that caught regressions cheaply.
- **Tight backlog tracking.** Marking each BL item done with a timestamped log entry as it landed kept
  status honest and traceable (Rule S4 / §3).

## What didn't (friction)

- **Env tooling gaps.** `node` and `python3`'s `yaml` module are unavailable locally; ruby was the only
  YAML parser. The validator was made tri-modal (ruby → python+pyyaml → grep) to stay portable.
- **Ruby `-e` + emoji.** Unicode glyphs inside the inline ruby script tripped US-ASCII source parsing;
  switched in-script output to plain ASCII (`[OK]`/`[FAIL]`) while keeping emojis in the bash echoes.
- **Producer ambiguity.** A few topics (e.g. `internal.auth.v1`, `internal.llmbot.v1`) have no explicit
  publisher in the file; producers were attributed to `event-router` based on the documented routing-slip
  dispatch behavior rather than guessing.

## Follow-ups (non-blocking)

- Consider a JSON Schema for `architecture.yaml` so the validator can enforce the new blocks' shape, not
  just YAML validity.
- Optionally wire the sprint validator into the repo-root `validate_deliverable.sh` / CI.
