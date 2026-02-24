# Deliverable Verification – sprint-259-d1sc0v

## Completed
- [x] Modified `RbacEvaluator` in `src/common/mcp/rbac.ts` to allow allowlisted agents to bypass role checks.
- [x] Updated `src/apps/tool-gateway.ts` to correctly extract `userId` from `x-user-id` header.
- [x] Verified tool discovery fix with `tests/repro_gateway_roles.spec.ts`.
- [x] Ensured no regressions in existing RBAC and Tool Gateway tests.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- The fix addresses the root cause of `llm-bot` only seeing a subset of tools by allowing it (as an allowlisted agent) to discover tools that require specific user roles.
