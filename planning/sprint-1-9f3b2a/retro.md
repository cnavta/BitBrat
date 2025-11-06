# Sprint 1 Retrospective — Local Deployment Bootstrap (sprint-1-9f3b2a)

Date: 2025-11-05 18:08 local
Role: Cloud Architect

## What went well
- Configuration‑first approach simplified local orchestration and reduced drift between envs
- Robust `.secure.local` parsing and ADC validation eliminated common setup pitfalls
- Root‑run enforcement + Compose preflight caught path issues early
- Parametric host port for `oauth-flow` resolved local conflicts cleanly
- Health endpoints standardized (`/healthz`, `/readyz`, `/livez`) and tested

## What was challenging
- Docker Compose `env_file` path resolution (project-directory vs include file path)
- ADC path edge cases (quotes, `export`, `~`) and volume mount constraints
- Initial port conflicts on 3000 required a quick design change

## What we learned
- Always add a `docker compose ... config` preflight step
- Enforce repo‑root execution to avoid brittle relative paths
- Parameterize external ports by default to avoid collisions on dev machines

## Action items
1. Cloud Build scaffolding for image build/test and Cloud Run deploy (dry‑run first)
2. IaC for Artifact Registry, Cloud Run service(s), and Secret Manager bindings
3. Optional: auto-detect a free host port for local services to reduce friction
4. Expand tests around config merge (unit tests for `merge-env.js`) in a later sprint

## Acknowledgements
- Quick stakeholder feedback on configuration and Compose include strategy accelerated resolution
