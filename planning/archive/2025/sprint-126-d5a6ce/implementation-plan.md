# Implementation Plan – sprint-126-d5a6ce

## Objective
- Produce a Technical Architecture (TA) document specifying the simplified command matching approach using two matching kinds (command | regex), sourcing sigils exclusively from config, and removing sigilOptional and termLocation.

## Scope
- In scope
  - Author TA document with data model, matching pipeline, annotations, safety/performance, observability, and testing recommendations
  - Create sprint artifacts and a validation script suitable for a documentation-only sprint
- Out of scope
  - Code changes to command-processor
  - Data migration of existing commands

## Deliverables
- planning/sprint-126-d5a6ce/technical-architecture.md
- planning/sprint-126-d5a6ce/validate_deliverable.sh
- planning/sprint-126-d5a6ce/request-log.md (updated)
- planning/sprint-126-d5a6ce/publication.yaml (initialized)

## Acceptance Criteria
- TA covers: data model updates; matching pipeline and priority ordering; annotation outputs for both kinds; Firestore schema/indexing and caching; regex safety; observability; testing strategy; alignment with architecture.yaml.
- ALLOWED_SIGILS are sourced from existing configs; no per-command sigils or termLocation remain in the design.
- Validation script succeeds locally (structure checks and lint-like guards).

## Testing Strategy (this sprint)
- Validate presence and basic structure of artifacts via validate_deliverable.sh.
- Future sprints: unit tests for command and regex matching; perf and ReDoS safety tests.

## Deployment Approach
- Documentation-only; no deploy changes.

## Dependencies
- Environment/config provides ALLOWED_SIGILS for the service.

## Definition of Done
- TA reviewed and approved; artifacts committed to feature branch; validation script logically passable.
