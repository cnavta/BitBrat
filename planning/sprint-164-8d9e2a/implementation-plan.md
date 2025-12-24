# Implementation Plan – sprint-164-8d9e2a

## Objective
Restore backward compatibility for external Load Balancer resource names in the `brat` tool to fix deployment errors.

## Scope
- `tools/brat/src/providers/cdktf-synth.ts`
- Associated tests in `tools/brat/src/providers/`

## Deliverables
- Fixed `cdktf-synth.ts` with restored naming for `main-load-balancer`.
- Updated test snapshots.

## Acceptance Criteria
- `main-load-balancer` (external) uses legacy TF resource names (`frontend_ip`, `managed_cert`, `main`, etc.).
- External backend services use `be-${sid}` (no suffix).
- Assets proxy for external LB uses `be-assets-proxy`.
- Internal LBs continue to work with unique names and `-internal` suffixes.
- No duplicate resource definitions in `main.tf` if multiple LBs share services.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Run existing LB synth tests.
- Update snapshots to confirm naming restoration.
- Verify `main.tf` content manually for a complex `architecture.yaml`.

## Definition of Done
- All tests pass.
- PR created.
