# Key Learnings – sprint-253-a2b3c4

- **Prefer Routing Slips**: Using `BaseServer.next()` is always preferable to static topic publishing for intermediate services like `auth`. It keeps the flow centralized and manageable via routing rules.
- **Multiple Topic Consumption**: Some services (like `event-router`) may need to consume from multiple disparate topics. The pattern of iterating through a list of topics and calling `onMessage` for each is an effective way to handle this.
- **Test-Only Env Flags**: Be careful with "skip in test" flags in production code. If they are too broad, they can prevent testing of core logic like message bus subscriptions. Prefer checking for specific disabling flags like `MESSAGE_BUS_DISABLE_SUBSCRIBE`.
