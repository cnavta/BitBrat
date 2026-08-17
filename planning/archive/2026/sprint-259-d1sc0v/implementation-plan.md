# Implementation Plan – sprint-259-d1sc0v

## Objective
- Fix the issue where `llm-bot` only discovers a maximum of 4 tools from `tool-gateway`.
- Fix the missing `userId` in `tool-gateway` session context.

## Scope
- `src/common/mcp/rbac.ts`: Update RBAC logic to allow trusted agents to bypass role checks.
- `src/apps/tool-gateway.ts`: Fix header extraction for `userId`.
- `tests/repro_gateway_roles.spec.ts`: Verification of the fix.

## Deliverables
- Modified `RbacEvaluator` with agent-bypass logic.
- Modified `ToolGatewayServer` with fixed header extraction.
- Passing tests.

## Acceptance Criteria
- `llm-bot` (or any allowlisted agent) can discover tools that require roles, even if the agent itself doesn't have those roles.
- `userId` is correctly extracted from `x-user-id` header in `tool-gateway`.
- Existing RBAC for non-allowlisted agents/users remains intact.

## Testing Strategy
- Use the reproduction test `tests/repro_gateway_roles.spec.ts` updated with an agent allowlist case.
- Run existing RBAC tests in `tests/common/mcp/rbac.spec.ts`.
- Run `tool-gateway` REST tests.

## Deployment Approach
- Standard CI/CD.

## Definition of Done
- Implementation matches the plan.
- All tests pass.
- `validate_deliverable.sh` created and passes.
- PR created and URL recorded.
- Retro and verification reports created.
