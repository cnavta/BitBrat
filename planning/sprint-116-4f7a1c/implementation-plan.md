# Implementation Plan – sprint-116-4f7a1c

## Objective
- Assess all existing services and produce a trackable YAML backlog to migrate message subscriptions to BaseServer.onMessage and HTTP endpoints to BaseServer.onHTTPRequest.

## Scope
- In scope: Service inventory, usage assessment, backlog authoring, planning artifacts, and validation wrapper.
- Out of scope: Actual service refactors (to be done in follow-up sprints after approval).

## Deliverables
- planning/sprint-116-4f7a1c/backlog.yaml (per-service tasks, acceptance, priorities)
- planning/sprint-116-4f7a1c/sprint-manifest.yaml (created)
- planning/sprint-116-4f7a1c/request-log.md
- planning/sprint-116-4f7a1c/validate_deliverable.sh
- planning/sprint-116-4f7a1c/verification-report.md
- planning/sprint-116-4f7a1c/publication.yaml
- planning/sprint-116-4f7a1c/retro.md
- planning/sprint-116-4f7a1c/key-learnings.md

## Acceptance Criteria
- backlog.yaml exists with tasks for: auth, event-router, ingress-egress, command-processor, oauth-flow, llm-bot.
- Each task has acceptance statements and a priority.
- No changes to runtime behavior yet; planning-only.
- Validation wrapper present and logically passable.

## Testing Strategy
- CI validation via repository-level validate_deliverable.sh (build and tests run). No new tests required for planning-only sprint.

## Deployment Approach
- None (planning-only). Future sprints will reference Cloud Run deployment per architecture.yaml.

## Dependencies
- None beyond repository code visibility.

## Definition of Done
- All deliverables present, branch created, PR attempted per AGENTS.md Publication rules.