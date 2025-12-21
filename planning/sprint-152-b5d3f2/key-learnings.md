# Key Learnings – sprint-152-b5d3f2

- **Twitch EventSub WebSocket**: This method is ideal for containerized environments like Cloud Run as it avoids the need for a public callback URL and complex SSL/challenge handling required by Webhooks.
- **Twurple User Context**: Twurple's `EventSubWsListener` and the underlying `HelixEventSubApi` have very specific user context requirements for v2 events. For subscriptions that don't take an explicit moderator (like `channel.update.v2`), Twurple defaults to the broadcaster's ID for the user context of the API call. "Token Aliasing" (registering the bot's token under the broadcaster's ID) is an effective workaround when only a single bot token is available.
- **Schema Extensibility**: Using an `externalEvent` field in the internal envelope allows us to support any number of platform-specific events by simply defining new "kinds" and payloads, keeping the top-level routing logic generic.
- **Dependency Management**: When working with highly modular libraries like Twurple, pinning versions across all packages is critical to avoid peer dependency hell.
