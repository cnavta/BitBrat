# Implementation Plan – sprint-137-9b7e21

## Objective
- Add a new canonical section, Conversation State / History, to the prompt assembly framework and publish the Technical Architecture (v2) for adoption.

## Scope
- In scope
  - Technical Architecture document describing the new layer, rendering rules, provider mappings, types, and migration guidance
  - Sprint planning artifacts (manifest, request log, validation script)
  - No production code changes in this sprint until plan is approved
- Out of scope
  - Implementing TypeScript library changes and adapters (planned for next sprint)
  - Service integrations and tests updates (planned subsequent to implementation)

## Deliverables
- Documentation
  - documentation/technical-architecture/prompt-assembly-v2-conversation-state.md
- Planning artifacts
  - planning/sprint-137-9b7e21/sprint-manifest.yaml
  - planning/sprint-137-9b7e21/request-log.md
  - planning/sprint-137-9b7e21/validate_deliverable.sh
  - planning/sprint-137-9b7e21/publication.yaml

## Acceptance Criteria
- Technical Architecture clearly defines:
  - Updated canonical order including [Conversation State / History]
  - Section label, formatting, and rendering rules
  - Revised types (new ConversationState, PromptSpec/AssembledPrompt updates)
  - Provider mappings (OpenAI, Google) that preserve the new order
  - Token budgeting & truncation strategy with state summarization
  - Security/redaction guidance for state/history
  - Migration guide from v1 (6 sections) to v2 (7 sections)

## Testing Strategy
- Documentation-only sprint:
  - Validate the presence of the new architecture doc
  - Scripted grep check for the required section label in validate_deliverable.sh
  - CI should still build and test the repo (no code changes expected)

## Deployment Approach
- No deployable artifacts in this sprint. Publication is via PR with documentation changes.

## Dependencies
- None for documentation creation. Subsequent sprints will depend on existing prompt-assembly code, llm-bot, and adapters.

## Definition of Done
- Technical Architecture document authored and reviewed
- Validation script logically passable (build/test + doc check)
- Feature branch created; changes committed and ready for PR creation after review
