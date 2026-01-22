# Retro – sprint-210-9b4e1a

## What worked
- The separation of concerns between `bootstrap-service.js` and `deploy-local.sh` made it clear where changes were needed.
- Using `grep` in the shell script to detect "image:" in the compose file was a lightweight way to avoid parsing YAML in Bash.
- The `obs-mcp` service served as a perfect test case for this feature.

## What didn’t work
- Initial attempt at `deploy-local.sh` dry-run failed because it was still strictly requiring a `Dockerfile` even if the compose file used an `image`.

## Learnings
- Local dev tools need to be flexible enough to handle both "build-from-source" and "pull-prebuilt-image" workflows, especially as we integrate third-party or externally built MCP servers.
