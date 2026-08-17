# Implementation Plan – sprint-168-c9d2e1

## Objective
- Restore missing synthesis logic for internal load balancer, proxy-only subnet, and DNS zones to fix deployment errors.

## Scope
- `tools/brat/src/providers/cdktf-synth.ts`: Update synthesis logic for `network` and `load-balancer` modules.

## Deliverables
- Updated `cdktf-synth.ts` with restored infrastructure logic.
- Unit tests for the restored logic.

## Acceptance Criteria
- `main.tf` for `network` stack includes `proxy_only_subnet`, `local_zone`, and `internal_zone`.
- `main.tf` for `load-balancer` stack includes internal load balancer resources and DNS records.
- Terraform plan no longer attempts to destroy active resources.

## Testing Strategy
- Unit tests in `tools/brat/src/providers/` to verify generated Terraform content.

## Definition of Done
- Code matches architecture.yaml constraints.
- `npm test` passes.
- PR created.
