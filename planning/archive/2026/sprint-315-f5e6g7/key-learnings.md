# Key Learnings – sprint-315-f5e6g7

- **Docker SSH Orchestration**: Setting `DOCKER_HOST=ssh://user@host` is the most efficient way to orchestrate remote Docker engines without installing additional agents.
- **Hierarchical Config Migration**: When migrating from Bash to TypeScript, using a dedicated class for Environment resolution makes it easier to handle edge cases like tilde expansion and quote stripping consistently.
- **Temporary Env Files**: Using temporary `.env` files is a clean way to pass complex, merged environment variables to Docker Compose without polluting the host environment or permanently modifying project files.
