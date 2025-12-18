# Key Learnings – sprint-143-e2f4a1

- Discord OAuth2 `bot` scope requires a `permissions` query parameter to pre-define the bot's abilities in the guild.
- Including `applications.commands` in the scopes is essential for modern bots to use slash commands.
- Centralizing configuration through `IConfig` and `buildConfig` ensures consistency across the platform.
