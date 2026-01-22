# Key Learnings – sprint-209-f8e9d0

- **Manual WS Upgrade**: When using `ws` with `express` (via `BaseServer`/`McpServer`), manual `upgrade` handling is the cleanest way to perform pre-connection authentication.
- **Firestore Token Storage**: Hashing tokens (SHA-256) before storage is essential for security, even in internal systems.
- **Connection Management**: Tracking WebSocket instances in a `Map<string, Set<WebSocket>>` allows for routing messages to multiple concurrent connections for the same user.
- **Event Mapping**: Mapping external "action" events (like `chat.message.send`) to internal "fact" events (`chat.message`) helps maintain a clean domain model.
- **Docker Compose & Env Files**: Docker Compose `env_file` entries are critical for local development. Paths in `env_file` must be relative to the `--project-directory` if one is specified, or to the compose file itself if not. In our case, using paths relative to the project root (e.g., `.env.local`) is the most robust approach when the deployment script sets the project directory. Also, `infrastructure/scripts/merge-env.js` already handles merging all `.yaml` overlays into `.env.local`, so additional `env_file` entries for individual YAML files are redundant and potentially error-prone.
