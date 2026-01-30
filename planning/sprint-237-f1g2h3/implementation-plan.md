# Implementation Plan – sprint-237-f1g2h3

## Objective
Fix formatting and location issues in Firestore data populated by `brat setup`.

## Deliverables
- Updated `tools/brat/src/cli/setup.ts` with correct token format and rule collection path.
- Updated `tools/brat/src/cli/setup.test.ts`.

## Acceptance Criteria
- Token document in Firestore contains `token_hash`, `uid`, and `createdAt`.
- Rules are imported into `configs/routingRules/rules`.

## Testing Strategy
- Unit tests in `setup.test.ts`.
- Manual verification using `brat setup` and checking Firestore data.
