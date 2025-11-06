# Key Learnings — Sprint 1

Date: 2025-11-05

1. Enforce repo‑root execution for all scripts to avoid brittle path assumptions across environments.
2. Favor configuration‑first flows: merge env YAMLs + secure overrides → single `.env.local` used by Compose and apps.
3. Normalize secure config parsing: accept `export`, strip quotes, expand `~`, and require absolute, space‑free paths for bind mounts.
4. Always include a `docker compose ... config` preflight to surface env_file and include path issues early.
5. Parameterize host ports by default; add preflight checks to catch conflicts and provide clear override guidance.
6. Keep emulator and infra in Compose, using service DNS names (not localhost) for in‑network communication.
7. Standardize health endpoints (`/healthz`, `/readyz`, `/livez`) and include in architecture defaults for consistency.
8. Document troubleshooting steps prominently in infra overview and planning artifacts.
