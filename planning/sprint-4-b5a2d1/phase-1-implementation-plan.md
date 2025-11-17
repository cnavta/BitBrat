# Phase 1 Implementation Plan — brat CLI (BitBrat Rapid Administration Tool)

Sprint: sprint-4-b5a2d1
Role: Lead Implementor
Source of Truth: architecture.yaml

Purpose
- Deliver the first working slice of the brat CLI that can run side-by-side with infrastructure/deploy-cloud.sh.
- Provide immediate value by orchestrating multi-service deployments via Cloud Build and wrapping Terraform plan/apply for IaC modules, without changing current production paths.

Scope (Phase 1)
- CLI scaffolding (oclif, TypeScript) with foundations: logging (pino), schema validation (zod), YAML config loader.
- Commands delivered:
  1) deploy services — parity with current multi-service path in deploy-cloud.sh (gcloud builds submit per service, bounded concurrency, shared tag). Includes secret mapping synthesis and version resolution to numeric, and env key selection + filtering parity.
  2) infra plan|apply — wrap Terraform init/validate/plan/apply against existing modules with env-derived tfvars.
- Global flags: --project-id, --region, --env, --dry-run, --verbose, --concurrency, --non-interactive.
- Zero changes to existing Bash script behavior; CLI is additive.

Out of Scope (Phase 1)
- CDKTF stacks (will be scaffolded later in Phase 3).
- Full migration of gcloud to Node SDKs (we will prefer gcloud via execa in Phase 1, add SDKs incrementally).
- Decommissioning deploy-cloud.sh (Phase 5).

Deliverables (Artifacts to be created in repo during implementation)
- src/cli (oclif command tree) with:
  - index.ts (entry)
  - commands/deploy/services.ts
  - commands/infra/plan.ts
  - commands/infra/apply.ts
  - commands/config/show.ts (minimal), commands/doctor.ts (minimal)
- src/config/schema.ts (zod schemas)
- src/config/loader.ts (architecture.yaml + env overlays resolution)
- src/orchestration/{logger.ts, queue.ts, exec.ts}
- src/providers/{terraform.ts} and src/providers/gcp/{cloudbuild.ts,secrets.ts}
- jest unit tests for config loader, secret resolution, env filtering, dockerfile inference, substitutions builder
- npm scripts to build and test remain unchanged; a new script may be added to run the CLI locally (npm run brat -- …)
- Draft Dockerfile.brat and cloudbuild.brat.yaml (non-blocking; used later for hermetic CI)

Acceptance Criteria (Phase 1)
- brat --help renders with documented global flags.
- brat deploy services --all executes Cloud Build submits for each discovered service using substitutions equivalent to deploy-cloud.sh, with:
  - Shared image tag derivation (git short SHA fallback to timestamp)
  - Secret mapping synthesis from architecture.yaml and resolution to numeric ENABLED versions
  - Env KV loading and filtering to avoid keys provided via secrets
  - Bounded concurrency honoring architecture.yaml deploymentDefaults.maxConcurrentDeployments (overridable via --concurrency)
  - Dry-run prints planned actions without side effects
- brat infra plan respects --dry-run (plan-only); infra apply runs terraform apply with the same var set as the bash script.
- Service images and any executable environments (Cloud Run, Docker Compose containers) MUST NOT contain brat source or binaries; brat is distributed/executed out-of-band as its own CLI image or Node entrypoint.
- Unit tests pass for core utilities (schema, loader, secret resolution, env filtering, substitutions builder).
- No changes to existing deploy-cloud.sh; both paths can be run for parity validation.

Dependencies & Assumptions
- Node 24+, Terraform installed locally, gcloud installed and authenticated for apply paths.
- architecture.yaml defines services and deploymentDefaults; env/<name> contains overlays; .env.<name> optional.
- Secrets creation/import is disabled by policy; only existence/versions are verified.

Work Breakdown Structure (WBS)
1. Project foundations
   - Add pino logger wrapper with pretty transport in dev; JSON by default.
   - Add exec wrapper around execa with standard error mapping and structured logs.
   - Add queue wrapper (p-limit) for bounded concurrency; add runId generator (git SHA/timestamp).
2. Config schema and loader
   - Define zod schemas for architecture.yaml sections used in Phase 1 (deploymentDefaults, services with fields: name, port, min/max, cpu, memory, allowUnauth, envKeys, secrets).
   - Implement loader to parse architecture.yaml and env/<name>/*.yaml and .env.<name>.
   - Implement env KV builder and filtering function (exclude keys present in secrets mapping).
3. Providers — GCP/Cloud Build and Secrets
   - cloudbuild.ts: build substitutions structure matching deploy-cloud.sh; execa("gcloud builds submit") bridge with strict args and output piping.
   - secrets.ts: resolve mapping ENV=SECRET:latest → ENV=SECRET:<number> by querying gcloud via execa initially; surface clear errors when no ENABLED versions exist.
4. Provider — Terraform adapter
   - terraform.ts: init/validate/plan/apply helpers; var-file creation matching bash (env JSON + secrets array) and named -var entries (project_id, region, service_name, repo_name, min/max, cpu, memory, port, allow_unauth).
5. Command — deploy services
   - Discover services (loader) and compute shared image tag (git short SHA else timestamp).
   - For each service, build dockerfile candidate names as in bash (Dockerfile.<service> or kebab-case variant); skip if not found.
   - Build env_kv according to envKeys (or all), synthesize missing secret mappings from declared secrets, resolve versions, filter env_kv, then invoke Cloud Build with substitutions.
   - Enforce concurrency using queue wrapper; write per-service logs to a temp directory and emit summary.
   - Honor --dry-run by printing planned actions.
6. Command — infra plan|apply
   - Build tfvars (env JSON + secrets JSON array) and run terraform via adapter in the selected env dir.
   - Honor --dry-run → plan; otherwise apply with -auto-approve.
7. Testing
   - Unit tests for: schema parsing, env loader and KV build, secret mapping synthesis and numeric resolution (mock gcloud), env filtering, substitutions builder, dockerfile inference, tag derivation.
   - Integration test (dry-run) to ensure command graph prepares correct substitutions for a sample fixture.
8. Packaging (draft)
   - Draft Dockerfile.brat and example cloudbuild.brat.yaml. Not required to publish in Phase 1, but ready for Phase 4.
9. Documentation
   - Update planning/request-log.md with work records; keep this plan under planning; add usage examples to README section inside planning if needed.

Command Specifications (Phase 1)
- brat deploy services [--all | <name>...]
  Flags: --project-id, --region, --env, --dry-run, --concurrency, --verbose
  Behavior: As described in WBS; parity with bash multi-service path.
- brat infra plan|apply [--env-dir <path>] [--service-name <name>] [--repo-name <name>] [--dry-run]
  Flags: --project-id, --region, --env, --dry-run
  Behavior: Delegate to terraform adapter; variables per current script.

Testing Strategy
- Jest unit tests colocated with modules: *.spec.ts.
- Mock execa to avoid real gcloud/terraform in unit tests.
- Provide a small fixture architecture.yaml under tests/fixtures with two services to validate substitutions.
- Add coverage goal ≥70% for new modules in Phase 1.

Risk & Mitigation
- gcloud CLI dependency flakiness → implement retries in exec wrapper; clear error categories.
- Secret resolution permissions → fail fast with actionable messages; allow dry-run preview.
- Config drift between bash and CLI → create a “golden” substitutions snapshot test to compare outputs.

Rollout & Validation
- Keep deploy-cloud.sh unchanged.
- Validate brat deploy services --all in dry-run against real repo, then apply in a sandbox project.
- Compare results and logs with bash for at least one service.

Definition of Done (Phase 1)
- Source compiles (tsc), unit tests pass, and brat --help works.
- deploy services and infra plan|apply commands execute successfully with dry-run and real apply (in sandbox).
- Planning artifacts updated and request-log includes entries for implementation.
- No changes conflict with architecture.yaml or violate secrets policy.

Traceability
- Ties to: planning/sprint-4-b5a2d1/architecture-iac-cli.md (Sections 3.2, 3.3, 3.4, 3.6; Phase 1 in 5.)
- Prompt ID: req-003 (Phase 1 plan by Lead Implementor)
