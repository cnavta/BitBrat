# Sprint 3 Retrospective — sprint-3-cd91e2

Date: 2025-11-11
Facilitator: Cloud Architect

## What went well
- Architecture-first deployment: centralized configuration via architecture.yaml eliminated hardcoded drift and made changes reproducible across services.
- Multi-service deploy orchestration with parallelism improved throughput while preserving observability through per-service logs.
- Bootstrap generator + BaseServer accelerated new service creation with consistent health endpoints, env validation, and stub routes.
- Robust secret/env handling with numeric version resolution and collision filtering reduced production misconfigurations.

## What was challenging
- Cloud Build substitutions and shell quoting caused several iterations; moving to bash arrays for argument passing was key.
- macOS Bash 3.2 compatibility required avoiding associative arrays and `wait -n`; introduced queue-based concurrency.
- GAR tag visibility and Cloud Run pull timing required additional synchronization before Terraform deploys.
- Differing deploy paths (Terraform single-service vs Cloud Build multi-service) needed careful parity for secrets/envs.

## What we learned
- Prefer explicit, typed substitution keys and pass composite data via semicolon-separated strings; decode safely inside build steps.
- Trace-level logs for secrets (names/versions only) are invaluable for diagnosing deployment anomalies without leaking values.
- Keep manual governance for Secret Manager to maintain a tight security posture while still automating read-only consumption.

## Action items
- Carry networking and load balancers to Sprint 4 (Serverless NEGs, DNS, TLS, WAF) with the same architecture.yaml-driven approach.
- Add observability assets (dashboards, alerts, uptime) and budget policies.
- Consider migrating existing services to BaseServer helpers for consistency.
- Evaluate moving Cloud Run deploys to digest pins in all paths (Terraform and CB) to avoid latest tag races entirely.
