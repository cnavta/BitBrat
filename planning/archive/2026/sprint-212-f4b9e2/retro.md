# Retro – sprint-212-f4b9e2

## What went well
- Rapid identification of the `docker compose` environment resolution behavior.
- Successful verification using `docker compose config`.
- Automated regeneration of all service files ensured consistency across the project.

## What could be improved
- The interaction between `env_file`, CLI `--env-file`, and `environment:` section in Docker Compose is subtle and could be better documented in the project guidelines.

## Conclusion
The issue was a mismatch in how Docker Compose resolves variables when using the short-hand `- VAR` syntax vs explicit `${VAR}` interpolation. Switching to explicit interpolation fixed the loading of variables from `.secure.local` via `.env.local`.