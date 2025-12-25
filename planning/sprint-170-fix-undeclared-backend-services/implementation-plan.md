# Implementation Plan – sprint-170-fix-undeclared-backend-services

## Objective
- Resolve Terraform "Reference to undeclared resource" errors in the `load-balancer` module.

## Scope
- Fix `tools/brat/src/providers/cdktf-synth.ts` output generation logic.
- Update/Add tests to ensure regression is captured.

## Deliverables
- Code fix in `cdktf-synth.ts`.
- Updated test expectations in `cdktf-synth.restore.test.ts` or related specs.

## Acceptance Criteria
- `npm test tools/brat/src/providers/cdktf-synth.restore.test.ts` passes.
- Generated `main.tf` for `load-balancer` has correct resource types in `backendServiceNames` output.

## Testing Strategy
- Unit tests in `tools/brat/src/providers/cdktf-synth.restore.test.ts` will be updated to specifically check the `backendServiceNames` output content.

## Definition of Done
- All tests green.
- `validate_deliverable.sh` passes.
- PR created.
