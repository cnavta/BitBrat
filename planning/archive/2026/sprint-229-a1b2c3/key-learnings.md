# Key Learnings – sprint-229-a1b2c3

- **Dynamic Identities**: Allowing clients to specify their own `userId` (with prefix restrictions) is a useful pattern for chat tools and interactive sessions.
- **Terminal UI**: ANSI escape codes are a zero-dependency way to improve CLI readability.
- **Egress Mapping**: Centralizing egress type mapping in `egress.ts` allows the platform to support diverse internal event types while keeping the client-side protocol simple.
