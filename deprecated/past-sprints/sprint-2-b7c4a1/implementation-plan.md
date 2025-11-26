# Sprint 2 — Implementation Plan (ID: sprint-2-b7c4a1)

llm_prompt: |
  Role: Cloud Architect
  Intent: Produce an executable implementation plan for Sprint 2 to deliver CI/CD (Cloud Build → GAR → Cloud Run dry‑run) and IaC for the `oauth-flow` service.
  Traceability: Derived from 2025‑11‑06 user inputs and repository `architecture.yaml`. This file is authoritative for Sprint 2 execution.

---

## 1) Objective & Scope

Objective
- Stand up the CI/CD path and IaC needed to build, publish, and dry‑run deploy `oauth-flow` to Cloud Run in GCP.
- Produce a running, correctly configured `oauth-flow` service in Cloud Run (allow unauthenticated this sprint), with Secret Manager bindings and least‑privilege IAM.

In Scope (this sprint)
- Cloud Build scaffolding for image build, tests, and Cloud Run deploy (dry‑run capable)
- IaC (Terraform) for:
  - Artifact Registry repository (GAR)
  - Cloud Run service configuration for `oauth-flow`
  - Service Accounts and IAM (build + runtime)
  - Secret Manager secrets and accessor bindings
- Validation scripts to run end‑to‑end in dry‑run
- Minimal unit tests to satisfy DoD (health endpoints for oauth‑flow)

Out of Scope (next sprint)
- VPC + Serverless VPC Connector
- External/Internal Load Balancers and ingress lockdown

References
- Canonical: `architecture.yaml`
- Sprint architecture: `planning/sprint-2-b7c4a1/architecture.md`

---

## 2) Confirmed Inputs and Assumptions

- Region: `us-central1`
- Service: `oauth-flow` (entry: `src/apps/oauth-service.ts`)
- Port: `3000`
- Health: `/healthz`, `/readyz`, `/livez`
- Required Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`
- Auth/Ingr.: Allow unauthenticated for this sprint; to be restricted next sprint
- GCP Project IDs:
  - prod: `twitch-452523`
  - dev: `bitbrat-local`
  - staging: n/a (not used this sprint)

Assumptions
- Root Dockerfile for service exists: `Dockerfile.oauth-flow`
- Jest configured at repo root (tests will be added/updated as needed)

Open Questions (blocking promotion but not dev work)
- Confirm dev/staging project IDs
- Confirm naming for Cloud Build triggers and whether to use per‑env repos or single repo

---

## 3) Deliverables

1. Cloud Build pipeline (service‑scoped)
   - File: `cloudbuild.oauth-flow.yaml` (at repo root)
   - Steps: `npm ci` → `npm test` → `npm run build` → Docker build/push to GAR → Cloud Run deploy (dry‑run by default)
   - Substitutions: `_SERVICE_NAME`, `_REGION`, `_REPO_NAME`, `_DRY_RUN`

2. Terraform IaC
   - Structure:
     - `infrastructure/gcp/modules/`
       - `artifact-registry-repo/` (GAR repo)
       - `service-accounts/` (build + runtime SAs)
       - `secrets/` (Secret Manager resources + IAM bindings)
       - `cloud-run-service/` (`google_cloud_run_v2_service` with env from SM)
       - `cloud-build-trigger/` (optional in this sprint; can be created via console if time‑boxed)
     - `infrastructure/gcp/prod/` (env overlay for `twitch-452523`)
       - `main.tf`, `variables.tf`, `outputs.tf`, `providers.tf`
   - Outputs: GAR repo name, runtime SA email, Cloud Run service URL

3. Unit tests (Jest)
   - File: `src/apps/oauth-service.test.ts`
   - Coverage: health endpoints return 200 and expected payload shape

4. Sprint validation script
   - File: `planning/sprint-2-b7c4a1/validate_deliverable.sh`
   - Runs: install → build → tests → docker build (local) → terraform init/validate/plan (no apply) → optional Cloud Build dry‑run via `gcloud builds submit --config cloudbuild.oauth-flow.yaml --substitutions=...,_DRY_RUN=true`

5. Documentation
   - This plan (`implementation-plan.md`)
   - `sprint-manifest.yaml` (sprint metadata, env mapping, and pointers)
   - `request-log.md` updates per prompt

---

## 4) Work Breakdown Structure (WBS)

A. Pipeline
- A1: Create `cloudbuild.oauth-flow.yaml` with substitutions and dry‑run flag
- A2: Verify build locally with Cloud Build (optional: `gcloud builds submit --config=cloudbuild.oauth-flow.yaml --substitutions=_DRY_RUN=true`)

B. IaC
- B1: Module: `artifact-registry-repo` for `bitbrat-services` in `us-central1`
- B2: Module: `service-accounts` to create:
     - `cloud-build-bb@<project>.iam.gserviceaccount.com`
     - `run-oauth-flow@<project>.iam.gserviceaccount.com`
- B3: Module: `secrets` to create 3 secrets and bind `secretAccessor` to runtime SA
- B4: Module: `cloud-run-service` with:
     - allowUnauthenticated=true (temporary)
     - ingress=all (temporary)
     - port=3000; min=0; max=3; cpu=1; memory=512Mi
     - env from Secret Manager
- B5: Env overlay `prod` targeting `twitch-452523`; run `terraform plan` only this sprint

C. Tests & App Sanity
- C1: Add Jest tests for `/healthz`, `/readyz`, `/livez` in `oauth-service`
- C2: Ensure `npm test` passes in Cloud Build and locally

D. Validation & Docs
- D1: Implement `planning/sprint-2-b7c4a1/validate_deliverable.sh`
- D2: Create `planning/sprint-2-b7c4a1/sprint-manifest.yaml`
- D3: Keep `planning/sprint-2-b7c4a1/request-log.md` updated

---

## 5) Acceptance Criteria

- CI pipeline builds and pushes image to GAR (dry‑run deploy step succeeds with `--dry-run`)
- Terraform `plan` for prod (`twitch-452523`) succeeds with no errors
- Runtime SA has only Secret Manager accessor on the three required secrets
- Cloud Run service definition matches `architecture.yaml` defaults and sprint architecture
- Jest tests for health endpoints pass in CI
- Validation script completes successfully end‑to‑end

---

## 6) Testing Strategy

- Unit Tests: Supertest against Express app for `/healthz`, `/readyz`, `/livez`
- Config Lint: `terraform validate` + `tflint` (if available; otherwise documented for next sprint)
- CI: Cloud Build runs `npm ci`, `npm test`, `npm run build`

---

## 7) Deployment Approach

- Build and push image with Cloud Build; deploy using `gcloud run deploy` with `--dry-run` during this sprint
- Secrets wired via `--set-secrets` (pipeline) and in Terraform module for config‑first parity
- Future change (next sprint): switch `ingress` to `internal-and-cloud-load-balancing` and remove `--allow-unauthenticated`

---

## 8) Dependencies & External Systems

- GCP project: `twitch-452523` (prod)
- Permissions for Cloud Build SA to push to GAR and deploy to Cloud Run
- Secret values provisioned in Secret Manager (actual values can be placeholders for `plan`; required for real deploy)

---

## 9) Definition of Done (DoD)

- Code Quality: Matches TypeScript and repo standards; aligns with `architecture.yaml`
- Unit Testing: New tests added for oauth‑flow health endpoints; CI green
- Deployment Artifacts: `cloudbuild.oauth-flow.yaml`, Terraform modules and env overlay present and validated
- Documentation: This plan, sprint manifest, and request log are present under `/planning/sprint-2-b7c4a1`
- Traceability: Files include sprint ID and are linked from manifest

---

## 10) Rollback/Recovery

- Images are tagged with `$SHORT_SHA`; previous digest can be redeployed
- Terraform changes are planned only (no apply in this sprint), avoiding destructive impact

---

## 11) Risks & Mitigations

- Missing non‑prod project IDs → proceed with prod overlay; add dev/staging overlays when confirmed
- Secrets not yet created → plan succeeds; deploy will be dry‑run until values exist
- IAM gaps for Cloud Build → include IAM grants in IaC; verify via `plan` and doc manual grant if needed for first run

---

## 12) Milestones & Timeline

- Day 1: Pipeline YAML + basic tests
- Day 2: Terraform modules and prod overlay; validation script
- Day 3: End‑to‑end validation (dry‑run), doc cleanup, PR prep

---

## 13) Publication (PR)

- Branch: `feature/sprint-2-b7c4a1`
- PR Title: `Sprint 2 Deliverables — oauth-flow CI/CD + IaC (dry-run)`
- PR Body: Link to this plan, validation results, verification report, and retro (post‑validation)

---

## 14) Approvals Needed

- Confirm dev/staging project IDs
- Approve temporary `allowUnauthenticated=true` for this sprint (Confirmed in prompt)
