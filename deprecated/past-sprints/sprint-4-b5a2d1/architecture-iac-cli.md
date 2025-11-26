# BitBrat IaC Orchestration CLI — Architecture Proposal

Author: Cloud Architect
Date: 2025-11-11
Sprint: sprint-4-b5a2d1
Source of Truth: architecture.yaml

## 1. Problem Statement
The current infrastructure orchestration is centered on a large Bash script `infrastructure/deploy-cloud.sh` (~683 lines). While it has grown to support multi-service Cloud Build deployments, Terraform orchestration, secret management constraints, and optional Cloud Build trigger creation, its complexity and shell-based ergonomics are becoming a scaling bottleneck as we:
- Add more infrastructure components (VPC, load balancers, networking rules, databases, observability, etc.).
- Require consistent behavior across local and remote environments, CI/CD, and ad-hoc developer workflows.
- Need stronger typing, schema validation, richer logging, and composable task orchestration.

This document proposes a TypeScript-based CLI as the single entrypoint for all build, test, and deploy operations across environments, while preserving and extending existing capabilities.

## 2. Current Capabilities (from deploy-cloud.sh)
Key features with line references:
- Flag parsing and defaults: lines 93–120 (flags), 49–85 (defaults), 122–133 (max concurrency detection via architecture.yaml or default).
- Mode selection: single-service vs multi-service at 141–147, 193–498.
- Single-service configuration extraction from architecture.yaml via Node extractors: 146–191 (env, secrets, service config).
- Multi-service orchestration with parallel Cloud Build submits and per-service logs: 193–371, 333–371 (job control), 226–233 (log dir and arrays), 346–356 (start jobs), 358–371 (wait and status collection), 479–497 (finalization).
- Cloud Build invocation with substitutions: 248–252 (multi) and 618–621 (single), shared tagging and dockerfile inference: 592–613.
- Secret handling: 405–453 (synthesize mappings, resolve to numeric versions), 257–293 (resolve_secret_versions), 295–331 (filter env vars that overlap with secret-provided keys).
- Environment loading: 505–547 (JSON and KV for Terraform and CB), 387–403 (per-service env KV), honoring ENV_KEYS selection.
- Terraform orchestration: 624–658 (init/validate/plan/apply, var-file composition 500–541, preflight checks 549–557).
- Optional helper ops: 560–572 (Cloud Run deletion protection fix), 662–680 (Cloud Build trigger creation).
- Conventions: enforce repo root 43–47; DRY-RUN behavior; concurrency cap; region and defaults from architecture.yaml; multi-service image tag derivation via git short SHA.

Observations:
- Strong domain knowledge is already encoded (service discovery from architecture.yaml, env overlays, concurrency, secrets).
- Bash limits maintainability, testability, and structured error handling.
- Several flows rely on gcloud; some can migrate to official GCP Node SDKs with controlled fallbacks to gcloud via execa.

## 3. Target Architecture
We will build `brat` (BitBrat Rapid Administration Tool) — a TypeScript CLI powered by oclif. It will be the canonical interface for:
- Build and test operations
- Local orchestration (Docker Compose)
- Cloud orchestration (GCP) across Terraform and selective CDKTF modules
- Service and infrastructure deployments (single, group, or all)
- Environment management and bootstrap (project, AR, secrets policy, triggers)

### 3.1 Stack
- TypeScript + oclif: command framework and help UX
- zod: configuration and CLI args/env schema validation
- pino: structured JSON logs (console pretty in dev)
- execa: process execution (Terraform, gcloud) with strict output parsing
- p-limit: bounded concurrency and task queue primitives
- yaml: architecture.yaml parsing (types generated via zod schemas)
- Google Cloud Node SDKs (Logging, Secret Manager, Cloud Build, Run, Artifact Registry, Cloud Resource Manager) with controlled fallbacks to gcloud for gaps
- CDKTF: selectively for resources that benefit from code (e.g., VPC topology generation), while retaining current Terraform modules for stability

### 3.2 Command Taxonomy
Global command: `brat [command] [subcommand]` with global flags: `--project-id`, `--region`, `--env`, `--dry-run`, `--verbose`, `--concurrency`, `--non-interactive`.

- brat doctor
  - Validate environment (Node, gcloud auth, Terraform, Docker), print versions
- brat config show|validate
  - Render resolved config from architecture.yaml + env overlays; validate with zod
- brat build [service|--all]
  - Build container(s) via Cloud Build; control tag strategy; supports substitutions and Dockerfile selection
- brat test [unit|integration|all]
  - Run Jest tests locally; options: coverage, watch
- brat local up|down
  - Docker Compose for local environment; read env/local/*; health-checks
- brat infra plan|apply [module]
  - Terraform/CDKTF orchestrations; modules: core (project/AR), network (VPC/LB), services (Cloud Run, Pub/Sub), data (Firestore), observability
  - Supports select modules or all; honors `--dry-run` (plan only)
- brat deploy services [name...|--all]
  - Existing multi-service flow: build+deploy via Cloud Build with bounded concurrency; secret version resolution; env filtering
- brat trigger create|update|delete
  - Cloud Build trigger mgmt using Node SDKs or gcloud fallback
- brat secrets resolve|check
  - Resolve Secret Manager versions to numeric; verify required secrets exist/enabled

Commands are composable and callable by CI (Cloud Build) and GH Actions; no environment-specific behavior hidden from CI.

### 3.3 Configuration Resolution
- Parse architecture.yaml as the canonical source of service definitions, deployment defaults, and parameters.
- Merge environment overlays from `env/<name>/*.yaml` and `.env.<name>` files.
- Validate effective config via zod schemas to guarantee required fields (e.g., service.port, min/max instances, auth flags) before execution.
- Support selection of env keys (ENV_KEYS) and exclusion when secrets provide the same keys (parity with existing Bash logic).

### 3.4 Orchestration and Concurrency
- Implement a task queue with p-limit to bound concurrent operations (builds/deploys); default from architecture.yaml `deploymentDefaults.maxConcurrentDeployments`.
- Provide structured per-task logs and aggregate summaries.
- Support global `--dry-run` to resolve and print all actions without side effects; dry-run propagates to Terraform (plan), gcloud (no-op), and SDK calls (describe/preview).

### 3.5 Providers and Adapters
- Terraform Adapter: wraps `terraform init/validate/plan/apply` with execa, consistent args, JSON plan output parsing option, and error decoding.
- CDKTF Adapter: for programmatically generated resources (e.g., VPC with subnets per region, LBs, standardized logging sinks). Emit synthesized Terraform for consistency with the rest of the stack; plan/apply via the Terraform Adapter.
- GCP Adapter: prefer official SDKs (Secret Manager, Cloud Build, Cloud Run Admin, Resource Manager). Where SDK gaps exist or IAM permission complexity is high, fallback to `gcloud` invocations with strict argument construction and stderr/sdtout parsing via execa.

### 3.6 Secrets Handling
- Maintain current policy: no automatic secret creation/import; only verify existence and resolve to latest ENABLED numeric version.
- Implement `secrets resolve` using the SDK to map `ENV=SECRET:<number>`; warn and hard-fail on missing ENABLED versions when not dry-run.
- Ensure env KV passed to deployments excludes keys provided via secrets to avoid value collisions.

### 3.7 Logging and Telemetry
- pino in JSON for machine readability; pretty transport in dev.
- Correlate operations with a run ID (git SHA or timestamp) and attach to each task log.
- Emit summary sections at the end: successes, failures, skipped, duration per task.

### 3.8 Error Handling and Retries
- All provider calls wrapped with retryable semantics (exponential backoff) for transient errors (API limits, networking).
- Classify errors: configuration, dependency, permission, resource state.
- Exit codes mapped to failure categories for CI visibility.

### 3.9 CI/CD Integration
- Expose the same commands from Cloud Build. Example build steps:
  - setup: `npm ci && npm run build`
  - test: `npm test -- --ci`
  - deploy: `node dist/cli.js deploy services --all --project-id=$PROJECT_ID --region=$REGION --env=$ENV`
- Provide `cloudbuild.*.yaml` templates per service but unify through the CLI where possible.

## 4. Module Boundaries and Directory Layout
```
src/
  cli/                # oclif command tree
    index.ts          # entrypoint
    commands/
      doctor.ts
      config/
        show.ts
        validate.ts
      build/
        index.ts
        services.ts
      test/
        unit.ts
        integration.ts
      local/
        up.ts
        down.ts
      infra/
        plan.ts
        apply.ts
      deploy/
        services.ts
      trigger/
        create.ts
        update.ts
        delete.ts
      secrets/
        resolve.ts
        check.ts
  config/
    schema.ts         # zod schemas and types
    loader.ts         # architecture.yaml + env overlays resolution
  orchestration/
    queue.ts          # p-limit queue wrapper
    logger.ts         # pino setup
    exec.ts           # execa utilities
  providers/
    terraform.ts      # Terraform adapter
    cdktf.ts          # CDKTF adapter
    gcp/
      cloudbuild.ts
      cloudrun.ts
      secrets.ts
      artifact.ts
      resource-manager.ts
  util/
    git.ts
    path.ts
    env.ts
infrastructure/
  cdktf/              # synthesized stacks (network, lb, etc.)
  gcp/terraform/      # existing Terraform modules retained
```

## 5. Migration Plan (Phased)
- Phase 0 — Planning (this sprint):
  - Approve architecture and implementation plan; no code changes to deployment behavior.
- Phase 1 — CLI Skeleton + Parity Commands:
  - Scaffold oclif CLI with config loader, logging, and `deploy services` command that delegates to Cloud Build using the same substitutions and secret resolution as the Bash script.
  - Add `infra plan|apply` wrapper calling existing Terraform.
  - Keep `deploy-cloud.sh` stable; CLI runs side-by-side for validation.
- Phase 2 — Secrets and Env Parity, Concurrency, Dry-Run:
  - Implement secrets resolve/check, env key selection and filtering, p-limit queue, run IDs, and structured logs.
- Phase 3 — CDKTF introduction:
  - Move network (VPC, subnets, LB) into CDKTF where programmatic composition yields value. Synthesize to Terraform and apply via adapter.
- Phase 4 — CI Unification:
  - Replace direct gcloud/generic scripts in Cloud Build with brat commands. Publish the brat CLI Docker image for hermetic CI reuse.
- Phase 5 — Decommission Bash:
  - Freeze and retire deploy-cloud.sh once parity verified, leaving a compatibility shim that calls brat.

## 6. Acceptance Criteria
- CLI provides help and validates required flags with zod.
- `brat deploy services --all` supports bounded concurrency, logs per service, and shared image tagging.
- `brat infra plan|apply` uses existing Terraform modules and supports `--dry-run`.
- Secrets resolve to numeric versions before deploy; env filtering mirrors current behavior.
- Architecture.yaml is the single source of truth for services, defaults, and env key selection.
- CI can call the CLI with identical behavior to manual invocations.

## 7. Risks and Mitigations
- SDK parity gaps with gcloud: use controlled fallback to gcloud via execa and strict output parsing.
- Secrets policy enforcement: keep non-creation policy and fail fast on missing ENABLED versions.
- Drift during migration: run both Bash and CLI in parallel for several sprints; add integration tests comparing outcomes.

## 8. Decisions
- Package the CLI as a Docker image for hermetic execution in CI: Yes. Image convention: `us-central1-docker.pkg.dev/<project>/tools/brat:<tag>`.
- CLI Name: brat (BitBrat Rapid Administration Tool).

## 9. Appendix — Current Script Flag/Feature Map
- Flags: lines 93–120, defaults 49–85
- Concurrency: 122–133
- Single vs multi: 141–147, 193–498
- Secret resolution: 257–293; synthesis 407–433; filter 295–331
- Env loading: 505–547; per-service 387–403
- Dockerfile selection: 458–468, 600–611
- Cloud Build: 248–252; 618–621
- Terraform: 624–658 (plus 500–541 vars)
- Trigger creation: 662–680
- Deletion protection fix: 560–572
- Pre-flights: 549–557


## 10. Packaging & Deployment Boundaries
- Brat is an out-of-band administrative CLI and must never be bundled into any application/runtime images or deployed to executable environments (e.g., Cloud Run services, Docker Compose service containers).
- The location of the brat source within this repository is unconstrained; however, service build contexts and Dockerfiles must exclude brat sources and dependencies.
  - Enforce via .dockerignore patterns and disciplined COPY directives in service Dockerfiles.
- Distribution model: brat is packaged and published as its own Docker image (tools/brat) for hermetic CI/CD usage; services must not depend on or embed this image.
- CI/CD usage: Cloud Build and GitHub Actions invoke brat (node script or the brat Docker image). Application service build steps must operate without the brat source tree present in the container image.
- Verification policy:
  - During publication/validation, ensure service images do not contain CLI artifacts (e.g., src/cli/**, oclif bins, @oclif/* packages) by design review and optional image-inspection steps.
  - Include an explicit acceptance criterion in phase plans to ensure brat is excluded from deployable artifacts.
