# Key Learnings – sprint-178-7c9a2d

- **MCP SSE Transports**: Each `SSEServerTransport` requires a unique session ID, and the `/message` endpoint must route requests to the correct transport instance.
- **Zod to JSON Schema**: MCP expects standard JSON Schema for tool inputs. `zod-to-json-schema` is a useful dependency if we need to expose raw schemas, although the SDK handles some conversion.
- **Express 5 and SSE**: No major issues were found with Express 5, but ensuring `res.flush()` (if using compression) or just keeping the connection alive without timeouts is key.
- **BaseServer Lifecycle**: Custom `close()` methods in subclasses must always call `super.close()` to ensure message bus unsubscriptions and resource shutdowns occur.
