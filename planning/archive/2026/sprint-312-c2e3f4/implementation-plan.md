# Implementation Plan – sprint-312-c2e3f4

## Objective
- Fix the `brat setup` command to correctly format `RuleDoc` objects in Firestore.
- Ensure the `routing` property is used instead of `routingSlip`.
- Ensure all rules include the mandatory `enrichments` property as per the `RuleDoc` interface.

## Scope
- `tools/brat/src/cli/setup.ts`
- `tools/brat/src/cli/setup.test.ts`

## Deliverables
- Corrected `tools/brat/src/cli/setup.ts`.
- Updated `tools/brat/src/cli/setup.test.ts`.

## Acceptance Criteria
- Routing rules in Firestore have the following structure:
  ```json
  {
    "enabled": true,
    "priority": number,
    "logic": "string",
    "routing": {
      "stage": "string",
      "slip": [ ... ]
    },
    "enrichments": { ... }
  }
  ```
- No `routingSlip` property at the top level of the Firestore document.

## Testing Strategy
- Add assertions in `tools/brat/src/cli/setup.test.ts` to check the exact structure of the saved rules.
- Run `npm test tools/brat/src/cli/setup.test.ts`.

## Definition of Done
- Code changes implemented.
- Tests pass.
- `validate_deliverable.sh` passes.
- PR created.
