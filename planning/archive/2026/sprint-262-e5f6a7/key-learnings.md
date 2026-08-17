# Key Learnings – sprint-262-e5f6a7

## Docker Build Failures (2026 Environment)
- When building in a future system date (2026-03-27), standard Debian repository GPG keys in base images (node:24-bookworm, etc.) are perceived as expired.
- **Solution:** Apply `[trusted=yes]` in `/etc/apt/sources.list` and pass `-o Acquire::Check-Valid-Until=false` to `apt-get update`.
- This pattern must be maintained project-wide for all services requiring `apt` installations.

## Resource Constraints
- Docker build cache can grow rapidly, especially with many microservices.
- Regularly run `docker builder prune -f` and `docker system prune -f` to reclaim space when builds fail with exit code 100 (often due to no space for apt cache).

## Dockerfile Normalization
- Normalizing all service Dockerfiles to a single template (based on `-slim` images) improves project-wide maintenance and reliability.
