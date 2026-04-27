# Sprint Retro – sprint-301-c7d8e9

## What Worked
- **MCP Pattern:** The standard `McpServer` base class made it very easy to define tools with Zod validation.
- **Routing Slip:** Leveraging the routing slip `id` for mode detection in `llm-bot` was cleaner than parsing text in multiple places.
- **Firestore Integration:** Using `FirestoreManager` ensured consistency with other services.

## What Didn't
- **Test Discovery:** Jest didn't initially find the new test file because it was in `src/apps/__tests__` and I didn't specify the pattern correctly in the first run.
- **Private Properties:** `registeredTools` being private in `McpServer` required casting to `any` for testing stubs.

## Learnings
- Always check the `base-server` and `mcp-server` implementations before assuming method names like `getTools`.
