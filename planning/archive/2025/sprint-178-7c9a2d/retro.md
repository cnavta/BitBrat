# Retro – sprint-178-7c9a2d

## What Worked
- **Inheritance Pattern**: Extending `BaseServer` allowed for immediate access to logging, config, and resource management without duplication.
- **SSE Integration**: Using `SSEServerTransport` from the MCP SDK was straightforward once the session management was correctly handled.
- **Middleware Reuse**: Creating a local `authMiddleware` within `McpServer` made the security implementation cleaner.

## What Didn't Work
- **SDK Versioning**: The initial assumption that the SDK supported high-level methods like `.tool()` was incorrect for version `1.25.1`. Using `setRequestHandler` solved this but required slightly more boilerplate.
- **Testing SSE**: Mocking the transport was essential to prevent Jest from hanging. Testing SSE connections via `supertest` requires careful response termination in mocks.

## Improvements for Next Sprint
- Always check the exact installed version of a third-party SDK before designing high-level wrappers.
- Consider moving the `authMiddleware` to a shared utility if other non-MCP services need similar token-based auth.
