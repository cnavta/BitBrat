# Deliverable Verification – sprint-171-f5e6g7

## Completed
- [x] Reverted underscore normalization in `tools/brat/src/providers/cdktf-synth.ts`.
- [x] Updated `lb.spec.ts`, `loadbalancer.test.ts`, `loadbalancer.routing.test.ts`, `restore.test.ts` to expect hyphenated addresses.
- [x] Updated snapshots.
- [x] Verified all tests pass with `validate_deliverable.sh`.

## Alignment Notes
- Resource addresses now use hyphens (e.g., `be-oauth-flow`) which should match the existing Terraform state and resolve deployment conflicts.
