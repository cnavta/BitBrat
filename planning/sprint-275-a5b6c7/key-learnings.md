# Key Learnings – sprint-275-a5b6c7

- `discord.js` `login()` method requires a Bot Token, and it's essential to ensure the OAuth flow properly extracts this token from the potentially nested response (`json.bot.token`).
- Token polling and reconnection logic should be initialized before potentially failing operations to ensure system resilience and self-healing.
- Async `setInterval` callbacks in Jest tests require `advanceTimersByTimeAsync` or manual promise flushing to verify behavior correctly.
