# Bootstrap Service Architecture and Process

Date: 2025-11-09
Sprint: sprint-3-cd91e2
Owner: Architect
Source of Truth: architecture.yaml

## Objective
Enable one-command scaffolding and deployment of a new service stub defined in architecture.yaml:

- Command: `npm run bootstrap:service -- --name <service>`
- Reads configuration from architecture.yaml (service entry, secrets, env, scaling, region, etc.)
- Generates a minimal runnable service app and test under src/apps
- Generates a per-service Dockerfile (Dockerfile.<service>)
- Uses the existing Cloud Build and Terraform pipeline, parameterized entirely by architecture.yaml values
- Immediate ability to deploy the new service stub via:
  - Dry-run: `npm run deploy:cloud -- --dry-run --service-name <service>`
  - Apply:   `npm run deploy:cloud -- --apply --service-name <service>`

## Architectural Principles
- architecture.yaml is canonical; code generation must not copy constants when runtime can read from architecture.yaml via the deploy scripts.
- Minimal scaffolding: Express stub with standard health endpoints, required secret assertions, and Jest tests.
- Reuse shared CI/CD: keep a single Cloud Build YAML and Terraform overlay, parameterized via substitutions/vars.
- Idempotency and safety: bootstrap does not overwrite files unless `--force`.

## Components

### 1) Bootstrap CLI (infrastructure/scripts/bootstrap-service.js)
- Inputs: `--name` (service key in architecture.yaml), `--force` (optional)
- Loads architecture.yaml and resolves:
  - `services[<name>].entry` (or defaults to `src/apps/<kebab-name>-service.ts`)
  - `services[<name>].secrets` (used to assert required env at startup)
- Generates:
  - src/apps/<entry>.ts — Express app with /livez, /readyz, /healthz, and root endpoint
  - src/apps/<entry>.test.ts — Jest tests for health endpoints
  - Dockerfile.<service> — Generic Node 24 multi-stage build running the compiled entry
- Logs created/skipped files and next steps.

### 2) Cloud Build (cloudbuild.oauth-flow.yaml)
- Parameterized with substitutions from deploy script, now including:
  - `_SERVICE_NAME`, `_REGION`, `_REPO_NAME`, `_TAG`, `_DRY_RUN`
  - `_PORT`, `_MIN_INSTANCES`, `_MAX_INSTANCES`, `_CPU`, `_MEMORY`, `_ALLOW_UNAUTH`
  - `_SECRET_SET_ARG` (from architecture.yaml secrets)
  - `_DOCKERFILE` (new) — path to the Dockerfile to use; defaults to Dockerfile.oauth-flow
- Uses `${_DOCKERFILE}` for the `docker build -f ...` step, allowing per-service Dockerfiles.
- Deploy step is conditional and typically skipped; Terraform is the deploy source of truth.

### 3) Deploy Orchestrator (infrastructure/deploy-cloud.sh)
- Already sources service config from architecture.yaml via extract-config.js (region, port, scaling, cpu/memory, allowUnauth, env keys, secrets).
- Enhancements for bootstrap:
  - Accepts `--dockerfile` flag and auto-selects `Dockerfile.<service>` when present, else falls back to Dockerfile.oauth-flow.
  - Passes `_DOCKERFILE` substitution to Cloud Build.
- Continues to:
  - Build+push image on `--apply` (or `--build-image`) with a robust tag
  - Wait for GAR tag propagation if building before Terraform apply
  - Provide Terraform env+secrets via a temp `override.auto.tfvars.json`

### 4) Terraform Overlay (infrastructure/gcp/prod)
- Single overlay remains parameterized by `var.service_name`, `var.port`, scaling, etc.
- Secrets are passed via `var.secrets` (derived from architecture.yaml for the chosen service).
- A shared runtime SA is used initially; future sprints can make SA per service.

## Control Flow
1. Author the service definition in architecture.yaml under `services` (name, optional entry, secrets, env, scaling, paths).
2. Bootstrap files:
   - `npm run bootstrap:service -- --name <service>`
3. Validate locally:
   - `npm run build && npm test`
4. Dry-run cloud deploy:
   - `npm run deploy:cloud -- --dry-run --service-name <service>`
5. Apply to prod:
   - `npm run deploy:cloud -- --apply --service-name <service>`

## File/Value Mapping
- Service Name —> `_SERVICE_NAME` (Cloud Build), `var.service_name` (Terraform), SERVICE_NAME env at runtime
- Dockerfile —> `_DOCKERFILE` (Cloud Build), chosen automatically or via `--dockerfile`
- Image Path —> `${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO_NAME}/${_SERVICE_NAME}:<tag>`
- Scaling/Port/Resources —> substitutions and Terraform vars sourced from architecture.yaml via extractor
- Secrets —> `_SECRET_SET_ARG` for optional CB deploy; `var.secrets` for Terraform; runtime `env_from_secrets`
- Env Vars —> Loaded from env/<env>/*.yaml + .secure.local, filtered by ENV_KEYS computed from architecture.yaml

## Idempotency & Safety
- `--force` required to overwrite existing files.
- Cloud Build deploy step skips when `_DRY_RUN=true`.
- Terraform plan used for dry-run; apply is explicit.

## Testing & Validation
- Unit tests cover generator helpers (kebab-case, template content includes endpoints and service name).
- Root `validate_deliverable.sh` continues to build, test, and run a dry-run deploy. Bootstrap does not alter this flow.

## Definition of Done
- `npm run bootstrap:service` produces app, test, and Dockerfile without errors.
- `npm run build` and `npm test` pass.
- `npm run deploy:cloud -- --dry-run --service-name <service>` completes (plan only).
- `npm run deploy:cloud -- --apply --service-name <service>` builds, pushes, and deploys the stub service.

## Future Enhancements
- Per-service runtime service accounts and IAM policy generation.
- Optional per-service Cloud Build YAML and triggers.
- Route and LB configuration scaffolding aligned to architecture.yaml `paths`.
