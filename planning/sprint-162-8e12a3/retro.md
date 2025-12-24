# Retro - sprint-162-8e12a3

## What worked
- Successfully identified the need for SSE support in the codebase.
- The flexible configuration parsing allows both standard MCP formats.
- Unit tests provided quick feedback on the transport selection logic.

## What didn't work
- Encountered some minor friction with the `eventsource` types in TypeScript, requiring a type cast.
- Initial guess for the transport name was `SseClientTransport` instead of `SSEClientTransport`.

## Lessons for future
- Always check the exact export names in third-party libraries when using TypeScript.
- Providing flexibility in configuration formats (array vs object) makes the system more robust for users.
