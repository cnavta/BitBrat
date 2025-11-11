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



# Key Learnings — Sprint 2

Date: 2025-11-07

1. Prefer config-first Cloud Run with Terraform; avoid image-not-found by ensuring GAR image exists before first apply or temporarily use a known image.
2. Set deletion_protection=false during iterative development; re-enable after stabilization to prevent accidental destroys.
3. Adopt pre-existing secrets into Terraform state to avoid recreation conflicts; keep import scripts idempotent.
4. Use connection-based GitHub repository resources for Cloud Build triggers; branch names should be anchored (e.g., ^main$) and Cloud Build connections/repos are global.
5. Consolidate operator workflows under a single orchestrator script (deploy-cloud.sh) to reduce human error and ensure repeatability.
6. Runtime env validation in the app prevents silent misconfigurations when Secret Manager bindings are missing or misnamed.



# Key Learnings — Sprint 4

Date: 2025-11-11

1. Streamed, structured logs vastly improve deploy feedback vs. buffered output; design CLIs to emit per-line context early.
2. Maintain strict packaging boundaries for admin tooling (brat) to keep runtime images lean and secure.
3. Keep secrets policy simple in early phases: resolve numeric versions and fail fast; add creation/import later if ever needed.
4. Side-by-side parity during migrations reduces risk; compare CLI outputs with incumbent scripts before switching over.
5. Prefer architecture.yaml as the single source of truth and generate substitutions/config from it to avoid drift.
