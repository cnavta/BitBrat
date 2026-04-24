# Retro - sprint-296-a2b3c4

## What worked
- Quick identification of the discrepancy between MCP response content and `McpBridge` consumption logic.
- Simple, high-impact fix that doesn't require complex timeout coordination changes.

## What didn't
- The original implementation of `image-gen-mcp` included the base64 data "just in case", which is a common pitfall in distributed systems that leads to "silent" performance degradation until timeouts are triggered.

## Improvements for next time
- Be more mindful of payload sizes in tool responses, especially when a cloud storage URL is already provided.
- Ensure that bridge components (`McpBridge`) can optionally handle binary/image data if needed in the future, rather than just silently discarding it while still paying the transport cost.