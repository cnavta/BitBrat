# Implementation Plan – sprint-171-f5e6g7

## Objective
- Realign synthesized Terraform resource addresses with existing state to prevent deployment conflicts (400/409 errors).

## Scope
- Revert resource ID normalization (underscore to hyphen) in `tools/brat/src/providers/cdktf-synth.ts`.
- Update unit tests and snapshots to match hyphenated naming.

## Deliverables
- Code changes in `cdktf-synth.ts`.
- Updated unit tests and snapshots.
- Sprint artifacts.

## Acceptance Criteria
- All synthesis tests pass.
- Synthesized HCL uses hyphenated resource addresses (e.g., `be-oauth-flow` instead of `be_oauth_flow`).
- No deployment conflicts when applying against existing state.

## Testing Strategy
- Run existing synthesis tests: `lb.spec.ts`, `loadbalancer.test.ts`, `loadbalancer.routing.test.ts`, `restore.test.ts`.
- Update snapshots with `-u`.

## Definition of Done
- Adheres to project and architecture.yaml constraints.
- `npm test` passes.
- PR created.
