# Deliverable Verification – sprint-183-lb-https

## Completed
- [x] Configure HTTPS on main-load-balancer in `architecture.yaml`
- [x] Use existing certificate `bitbrat-${ENV}-cert` in `architecture.yaml`
- [x] Enable HTTPS redirect in `architecture.yaml`
- [x] Implement HTTPS redirect logic in `tools/brat/src/providers/cdktf-synth.ts`
- [x] Add unit tests for HTTPS redirect and custom certificate in `tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts`
- [x] Verify all 5 tests pass in the load balancer routing test suite

## Partial
- None

## Deferred
- None

## Alignment Notes
- `architecture.yaml` now explicitly requests HTTPS redirect via `https_redirect: true`.
- The `brat` tool was updated to support this new field in the `global-external-application-lb` implementation.
- Certificate interpolation correctly resolves to `bitbrat-dev-cert` in dev and `bitbrat-prod-cert` in prod.
