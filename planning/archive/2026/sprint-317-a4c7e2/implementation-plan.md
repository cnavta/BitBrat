# Implementation Plan – sprint-317-a4c7e2

## Objective
- Add a "Part 2" to the existing `!lurk` command tutorial series that expands on the initial tutorial by introducing routing to the `llm-bot`, prompt annotations, and personalities. (User-approved: "Please plan and execute the above.")

## Scope
### In scope
- New tutorial doc that begins exactly where `documentation/tutorials/lurk-command.md` ends.
- Step: change the routing doc/rule to route the `!lurk` event to the `llm-bot`.
  - Add a prompt annotation: `Generate a random lurk response for ${user.displayName}`.
  - Remove the existing candidate enrichments.
  - Test with the default personality in place.
- Step: add a personality.
  - Explain the `/personalities` collection and add a personality document.
  - Update the `!lurk` routing rule to add a personality attribution.
- A small link from Part 1 to Part 2 for discoverability.

### Out of scope
- Any changes to platform service code (`src/`), infrastructure, or runtime behavior.
- Authoring/altering production Firestore data; the tutorial shows local-emulator commands only.

## Deliverables
- `documentation/tutorials/lurk-command-part-2.md` (the Part 2 tutorial).
- A personality seed example referenced by the tutorial (`documentation/reference/setup/lurk_personality.json`).
- A "Next" link added to the end of `documentation/tutorials/lurk-command.md`.
- Sprint artifacts: manifest, implementation plan, request log, validation script, verification report, publication, retro, key-learnings.

## Acceptance Criteria
- Part 2 opens by continuing from the end of Part 1 (no re-teaching of basics).
- Tutorial replaces the `candidates`/`randomCandidate` enrichments with a `prompt` annotation whose value is `Generate a random lurk response for ${user.displayName}`.
- Tutorial routes the event to the `llm-bot` via a routing slip step (`id: llm-bot`, `nextTopic: internal.llmbot.v1`).
- Tutorial includes a first test pass using the default personality.
- Tutorial explains the `/personalities` collection (schema + selection) and provides a personality document to upsert.
- Tutorial updates the rule to add a `personality` annotation attribution.
- All internal doc links resolve; JSON snippets are valid.

## Testing Strategy
- Documentation-only deliverable: validation performs structure checks, internal link checks, and JSON snippet validity checks via `validate_deliverable.sh`.

## Deployment Approach
- None (documentation only). No Cloud Build/Cloud Run changes.

## Dependencies
- Existing docs: `documentation/tutorials/lurk-command.md`, `documentation/concepts/event-router-rules.md`, `documentation/llm-bot-personality.md`.
- Reference rules: `documentation/reference/setup/bot_mention_rule.json`, `cnj_rule.json`.
- Tooling reference: `npm run firestore:upsert`.

## Definition of Done
- References the project-wide DoD in `AGENTS.md` (Documentation section): rationale/notes present, traceable to this sprint and request IDs in `request-log.md`, validation pipeline passes for docs.
