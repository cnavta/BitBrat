# Development Guidance

Read this file before changing product code, tests, scripts, or infrastructure.

## Project Structure

```text
deprecated/           # Historical reference only; never a deliverable dependency
examples/             # Useful templates
planning/             # Sprint-management artifacts
preview/              # Directional, non-binding artifacts
infrastructure/       # IaC, Cloud Build, Terraform files
tools/brat            # brat (BitBrat Remote Administration Tool) source
tools/prompt-assembly # prompt spec framework source
src/
  apps/               # Service entrypoints
  common/             # Shared utilities
  config/             # Configuration
  services/           # Core microservices
  types/              # Shared types
```

## Code Style

- Application and service code is TypeScript unless a service defines another stack.
- Use kebab-case filenames, PascalCase classes/interfaces, camelCase functions/variables, and UPPER_SNAKE_CASE constants.
- Keep scripts and infrastructure in their native formats.

## Application Logging

- Use a logging facade when possible.
- Use `info` for useful operations, `error` for failures, and `debug` for deep diagnostics.
- Log network and filesystem operations with relevant context; never log secrets.

## Error Handling and Events

- Use disciplined error boundaries and graceful shutdown.
- Validate required environment variables at startup.
- Use Pub/Sub for service communication when applicable.
- Normalize external events to the internal schema.
