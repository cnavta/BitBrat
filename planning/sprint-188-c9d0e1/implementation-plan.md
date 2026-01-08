# Implementation Plan – sprint-188-c9d0e1

## Objective
- Fix the `AI_APICallError` related to invalid JSON schema for `mcp_create_schedule`.

## Scope
- `src/apps/scheduler-service.ts`: Update Zod schemas to be more explicit for array items.
- `src/common/mcp-server.ts`: (Optional) Check if `zod-to-json-schema` options can be tuned, but fixing the Zod schema is preferred.

## Deliverables
- Updated `scheduler-service.ts` with refined Zod schemas.
- Verification script or test confirming valid JSON schema generation.

## Acceptance Criteria
- `mcp:create_schedule` tool schema is valid for OpenAI (must have `items` for all arrays).
- No regression in tool functionality.

## Testing Strategy
- Create a unit test in `tests/apps/scheduler-service-schema.spec.ts` that exports the tool schemas and validates them against a JSON schema validator (like `ajv`) or simply checks for the presence of `items` in array properties.
- Run `npm test`.

## Definition of Done
- Code changes implemented.
- Tests pass.
- `validate_deliverable.sh` pass.
- PR created.
