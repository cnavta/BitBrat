# Deliverable Verification – sprint-255-b7a1e2

## Completed
- [x] **Discovery Bypass for Trusted Agents**: Updated `tool-gateway.ts` to allow `llm-bot` or sessions with `discovery` role to see all tools/resources/prompts during discovery.
- [x] **JSON Schema Emission Fix**: Improved conversion of Zod schemas to JSON Schema in the gateway to ensure LLMs receive concrete object schemas.
- [x] **Tool Invocation Debug Logging**: Added detailed logs (`.start`, `.success`, `.error`) for all tool, resource, and prompt calls in both REST and MCP interfaces.
- [x] **Regression & Integration Tests**: Updated `tests/apps/tool-gateway-mcp-rbac.spec.ts` to verify discovery visibility and invocation enforcement.

## Partial
- None

## Deferred
- **B-2: RBAC Discovery Authorization**: Optionally centralizing the bypass logic in `RbacEvaluator` was deferred as the current inline check is sufficient and safe.

## Alignment Notes
- Invocation security remains strictly enforced per-request via `_meta` as implemented in the previous sprint. Discovery expansion only affects visibility, not execution.
