# Sprint 2 Architecture — Cloud Build + Cloud Run (oauth-flow)

llm_prompt: |
  Role: Cloud Architect
  Intent: Define the sprint-level cloud architecture to build and dry-run deploy the oauth-flow service using GCP Cloud Build, Artifact Registry, Cloud Run, and Secret Manager. Align with architecture.yaml and anticipate next-sprint networking (VPC + ILB/ELB) without blocking future internal-only ingress.
  Traceability: Derived from user prompt dated 2025-11-05 19:24 and repository architecture.yaml. Sprint ID: sprint-2-b7c4a1.

## 1) Objective
Enable a CI/CD foundation that:
- Builds and tests the oauth-flow service container
- Publishes images to Google Artifact Registry (GAR)
- Performs a dry-run deploy to Cloud Run with correct configuration
- Provisions minimal IaC for supporting resources (GAR repo, service accounts, IAM, Secret bindings)
- Prepares for future VPC + External/Internal Load Balancers while allowing current sprint scope to remain Cloud Run–only

Target service (from architecture.yaml):
- name: oauth-flow
- entry: `src/apps/oauth-service.ts`
- default port: 3000 (from architecture defaults)
- health endpoints: `/healthz`, `/readyz`, `/livez`
- required secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`

## 2) Scope (This Sprint)
In-scope:
- Cloud Build pipeline for oauth-flow
  - npm ci → unit tests (Jest) → compile → build container (Dockerfile.oauth-flow) → push → Cloud Run deploy (dry-run)
- IaC for:
  - Artifact Registry repository (regional)
  - Cloud Run service definition (configuration-first; deploy step will be dry-run)
  - Secret Manager secrets and bindings
  - Service accounts + IAM for build and runtime
- Environment strategy and naming conventions
- Security posture consistent with future internal-only design but allowing unauthenticated ingress temporarily if needed

Out-of-scope (deferred to next sprint):
- VPC creation and Serverless VPC Connector
- External and Internal Load Balancers
- Centralized domain routing through LB

## 3) Design Principles and End-State Alignment
- Single source of truth: `architecture.yaml` (canonical). This document implements that intent for cloud.
- Future internal-only ingress: Cloud Run service will be defined so it can easily switch `ingress` and `authentication` without image rebuilds. For this sprint, allow unauthenticated traffic if needed; next sprint will restrict to Internal & Cloud Load Balancing and attach to a VPC via Serverless VPC Connector.
- Minimal blast radius: service-scoped runtime service account with least-privilege access to only required secrets.
- Traceability: Cloud Build substitutions embed commit SHA; artifacts and revisions labeled with `sprint_id=sprint-2-b7c4a1`.

## 4) GCP Resources (Per-Environment)
Region: `us-central1` (per architecture defaults)
Project(s): `bitbrat-<env>` pattern (dev/staging/prod). Exact IDs to be confirmed.

### 4.1 Artifact Registry (GAR)
- Repository: `bitbrat-services` (type: Docker)
- Location: `us-central1`
- Image URL pattern: `us-central1-docker.pkg.dev/${PROJECT_ID}/bitbrat-services/oauth-flow:${SHORT_SHA}`
- Retention: Optional policy to keep last N and 14-day TTL (future hardening)

### 4.2 Service Accounts
- Build SA: `cloud-build-bb@${PROJECT_ID}.iam.gserviceaccount.com`
  - Roles:
    - `roles/artifactregistry.writer`
    - `roles/run.admin` (deploy)
    - `roles/iam.serviceAccountUser` on runtime SA
    - `roles/secretmanager.secretAccessor` for deploy-time validation (read metadata and bind)
- Runtime SA: `run-oauth-flow@${PROJECT_ID}.iam.gserviceaccount.com`
  - Roles (least privilege):
    - `roles/secretmanager.secretAccessor` on required secrets only
    - (future) VPC access when Serverless VPC Connector is added

### 4.3 Secret Manager
- Secrets (per environment):
  - `TWITCH_CLIENT_ID`
  - `TWITCH_CLIENT_SECRET`
  - `OAUTH_STATE_SECRET`
- Access bindings:
  - Grant `secretAccessor` to `run-oauth-flow` SA on these three secrets
- Deployment binding in Cloud Run via `--set-secrets` or Terraform `env` block wired to SM

### 4.4 Cloud Run: Service oauth-flow
- Name: `oauth-flow`
- Region: `us-central1`
- Image: from GAR as above
- Resources: CPU `1`, Memory `512Mi` (matches architecture defaults)
- Scaling: min `0`, max `3` (architecture defaults)
- Port: `3000`
- Concurrency: default (80); can be tuned later
- Ingress: `all` for now; future `internal-and-cloud-load-balancing`
- Auth: `allowUnauthenticated: true` for now; future remove unauthenticated and route via LB
- Health checks: HTTP `/livez`, `/readyz`, `/healthz`
- Env Vars: set from Secret Manager (above) + non-secret config (e.g., `SERVICE_NAME=oauth-flow`)
- Observability: Cloud Logging + Cloud Monitoring (defaults)

## 5) CI/CD — Cloud Build Pipeline
Primary intent: one pipeline per service; triggers per-branch/environment.

### 5.1 Triggers
- `oauth-flow-dev`: on push to `main` (paths: `src/apps/oauth-service.ts`, `Dockerfile.oauth-flow`, `infrastructure/**`, `architecture.yaml`, planning files)
- Similar triggers for staging/prod with approvals

### 5.2 Substitutions
- `_SERVICE_NAME=oauth-flow`
- `_REGION=us-central1`
- `_REPO_NAME=bitbrat-services`
- `_DRY_RUN=true`

### 5.3 cloudbuild.yaml (Service-scoped)
```yaml
options:
  logging: CLOUD_LOGGING_ONLY
  substitutionOption: ALLOW_LOOSE
substitutions:
  _SERVICE_NAME: oauth-flow
  _REGION: us-central1
  _REPO_NAME: bitbrat-services
  _DRY_RUN: 'true'
steps:
  - id: 'Install deps'
    name: 'gcr.io/cloud-builders/npm'
    args: ['ci']

  - id: 'Run unit tests'
    name: 'gcr.io/cloud-builders/npm'
    args: ['test', '--', '--ci', '--reporters=default']

  - id: 'Build (tsc)'
    name: 'gcr.io/cloud-builders/npm'
    args: ['run', 'build']

  - id: 'Docker build'
    name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-f'
      - 'Dockerfile.oauth-flow'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/${_REPO_NAME}/${_SERVICE_NAME}:$SHORT_SHA'
      - '.'

  - id: 'Docker push'
    name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/${_REPO_NAME}/${_SERVICE_NAME}:$SHORT_SHA'

  - id: 'Cloud Run deploy (dry-run)'
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: 'bash'
    args:
      - -c
      - |
        IMAGE="us-central1-docker.pkg.dev/$PROJECT_ID/${_REPO_NAME}/${_SERVICE_NAME}:$SHORT_SHA"
        if [ "${_DRY_RUN}" = "true" ]; then DRY='--dry-run'; else DRY=''; fi
        gcloud run deploy ${_SERVICE_NAME} \
          --image "$IMAGE" \
          --region ${_REGION} \
          --platform managed \
          --allow-unauthenticated \
          --port 3000 \
          --min-instances 0 \
          --max-instances 3 \
          --cpu 1 --memory 512Mi \
          --set-secrets TWITCH_CLIENT_ID=TWITCH_CLIENT_ID:latest,TWITCH_CLIENT_SECRET=TWITCH_CLIENT_SECRET:latest,OAUTH_STATE_SECRET=OAUTH_STATE_SECRET:latest \
          $DRY

images:
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/${_REPO_NAME}/${_SERVICE_NAME}:$SHORT_SHA'
```
Notes:
- Test step uses existing Jest config.
- `--allow-unauthenticated` is temporary. Next sprint will remove and restrict via LB.
- Secrets are referenced by name with `:latest` for simplicity during setup. Pin versions in staging/prod.

## 6) IaC (Terraform) — Outline
Directory: `infrastructure/gcp/<env>/` with shared modules under `infrastructure/gcp/modules/*`.

Modules:
- `artifact-registry-repo`
  - inputs: name, location, format
- `service-accounts`
  - creates build SA and runtime SA for oauth-flow
- `secrets`
  - creates Secret Manager secrets and IAM bindings to runtime SA
- `cloud-run-service`
  - defines oauth-flow service (config-first) — image reference may be set to a placeholder initially; deploy is handled by Cloud Build
- `cloud-build-trigger`
  - defines trigger(s) for oauth-flow, with manual approval in staging/prod

Example (pseudo-HCL snippets):
```hcl
module "repo" {
  source   = "../modules/artifact-registry-repo"
  name     = "bitbrat-services"
  location = var.region
  format   = "DOCKER"
}

module "sa" {
  source        = "../modules/service-accounts"
  project_id    = var.project_id
  runtime_names = ["run-oauth-flow"]
  build_names   = ["cloud-build-bb"]
}

module "secrets" {
  source      = "../modules/secrets"
  secrets     = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "OAUTH_STATE_SECRET"]
  accessor_sa = module.sa.runtime_sas["run-oauth-flow"].email
}

module "run_oauth" {
  source            = "../modules/cloud-run-service"
  name              = "oauth-flow"
  region            = var.region
  min_instances     = 0
  max_instances     = 3
  cpu               = 1
  memory            = "512Mi"
  allow_unauth      = true
  ingress           = "all"
  port              = 3000
  service_account   = module.sa.runtime_sas["run-oauth-flow"].email
  env_from_secrets  = {
    TWITCH_CLIENT_ID     = "TWITCH_CLIENT_ID"
    TWITCH_CLIENT_SECRET = "TWITCH_CLIENT_SECRET"
    OAUTH_STATE_SECRET   = "OAUTH_STATE_SECRET"
  }
}

module "cb_trigger" {
  source        = "../modules/cloud-build-trigger"
  service_name  = "oauth-flow"
  repo_name     = "bitbrat-services"
  region        = var.region
  branch_regex  = "main"
}
```

## 7) Security & IAM
- Principle of least privilege on runtime SA (`run-oauth-flow`) with only Secret Manager access required for startup.
- Build SA allowed to deploy to Cloud Run and push to GAR. Consider manual approvals for non-dev envs.
- Label resources with `env`, `service`, and `sprint_id`.
- No public IPs; Cloud Run is serverless managed (Google front-ends). Temporary unauthenticated access allowed; will be constrained via LB next sprint.

## 8) Environments & Promotion
- Dev: auto-deploy on merge to `main` (dry-run until secrets and approval gates ready)
- Staging/Prod: manual/approval required; pin secret versions; `--no-traffic` followed by promotion step
- Images promoted by digest; Cloud Run updated with immutable digests to ensure rollback

## 9) Observability
- Cloud Logging enabled by default
- Basic metrics in Cloud Monitoring
- Add labels/annotations with commit SHA, sprint ID, and build ID

## 10) Risks & Mitigations
- Missing secrets → deploy will fail; mitigated by Terraform managing secrets and preflight checks
- Overly permissive access (temporary unauth) → mitigated by next sprint’s LB + internal ingress; tracked as explicit follow-up
- Drift between Terraform and gcloud deploy flags → prefer config-first via Terraform for final state; use gcloud only in pipeline with same desired flags

## 11) Acceptance Criteria (Sprint 2 — Architecture)
- Architecture document approved
- Terraform module layout agreed
- cloudbuild.yaml shape approved
- Naming and IAM model approved

## 12) Open Questions
- Confirm GCP project IDs (dev/stage/prod) to bake into IaC variables and triggers
- Confirm whether dev should remain unauthenticated or immediately use IAP/LB once VPC/LB land next sprint

