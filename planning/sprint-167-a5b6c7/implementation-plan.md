# Implementation Plan – sprint-167-a5b6c7

## Objective
- Resolve Zod validation errors in `architecture.yaml` preventing tools like `brat` from loading the configuration.

## Scope
- `tools/brat/src/config/schema.ts`: Update Zod schema to allow `regional-internal-application-lb` as a valid implementation for load balancers.

## Deliverables
- Code fix in `tools/brat/src/config/schema.ts`.
- Updated tests (if needed, though existing repo tests serve as verification).

## Acceptance Criteria
- `npm test tools/brat/src/lb/urlmap/__tests__/from-repo-arch.test.ts` passes.
- `npm test tools/brat/src/config/loader.spec.ts` passes.

## Testing Strategy
- Run the failing tests identified in the issue description.
- Ensure all other schema-related tests pass.

## Definition of Done
- Validation errors resolved.
- Pull Request created.
