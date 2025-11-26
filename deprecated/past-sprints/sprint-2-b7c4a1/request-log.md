# Sprint 2 — Request Log (ID: sprint-2-b7c4a1)

This log captures user prompts and the agent’s interpretations/actions for traceability.

---

## 2025-11-06T12:50-05:00 — Prompt ID: req-20251106-a1
Prompt
> Answers to open questions:
>  - GCP project IDs:
>    - bitbrat-prod: twitch-452523
>  - For this sprint, allow unauthenticated and we will lock it down next sprint.

Interpretation
- Confirm prod project ID as `twitch-452523`.
- Set `allowUnauthenticated=true` for Cloud Run during Sprint 2; plan to remove next sprint.

Actions
- Created `planning/sprint-2-b7c4a1/implementation-plan.md` reflecting these decisions.
- Created `planning/sprint-2-b7c4a1/sprint-manifest.yaml` with project mapping and flags.
- Logged this request.

Artifacts
- implementation plan: planning/sprint-2-b7c4a1/implementation-plan.md
- sprint manifest: planning/sprint-2-b7c4a1/sprint-manifest.yaml


## 2025-11-06T12:55-05:00 — Prompt ID: req-20251106-a2
Prompt
> Dev project ID: bitbrat-local
> Staging project ID: No staging t this time.
> Proceed with implementing CI/CD and IaC per plan now? yes

Interpretation
- Set dev project ID to `bitbrat-local` and omit staging for this sprint.
- Proceed to implement CI/CD and IaC deliverables immediately per plan.

Actions
- Updated `sprint-manifest.yaml` with dev=bitbrat-local and staging=null.
- Updated `implementation-plan.md` GCP project IDs.
- Added CI/CD config: `cloudbuild.oauth-flow.yaml`.
- Added unit tests: `src/apps/oauth-service.test.ts` (health endpoints).
- Implemented Terraform modules: GAR repo, service accounts + IAM, secrets + bindings, Cloud Run service.
- Created prod overlay: `infrastructure/gcp/prod/{providers.tf,variables.tf,main.tf,outputs.tf}` targeting `twitch-452523`.
- Ensured validation script is present: `planning/sprint-2-b7c4a1/validate_deliverable.sh`.

Artifacts
- cloudbuild: cloudbuild.oauth-flow.yaml
- tests: src/apps/oauth-service.test.ts
- terraform modules: infrastructure/gcp/modules/*
- prod overlay: infrastructure/gcp/prod/*


## 2025-11-06T22:51-05:00 — Prompt ID: req-20251106-exec
Prompt
> Please execute this plan

Interpretation
- Execute remaining Sprint 2 items to align runtime with Secret Manager and smooth Terraform planning against pre-existing secrets.

Actions
- Added runtime env validation to oauth-service to fail fast on missing secrets (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET).
- Created script to import pre-existing Secret Manager secrets into Terraform state: infrastructure/gcp/scripts/import-existing-secrets.sh.
- Updated sprint validation script to run the import script before terraform plan: planning/sprint-2-b7c4a1/validate_deliverable.sh.
- Verified build and unit tests locally via npm scripts.

Artifacts
- src/apps/oauth-service.ts (ensureRequiredEnv and main guard)
- infrastructure/gcp/scripts/import-existing-secrets.sh
- planning/sprint-2-b7c4a1/validate_deliverable.sh (updated)


## 2025-11-07 — User approvals and actions taken
- Prompt: Approvals to finalize Sprint 2 deliverables (switch Terraform to GAR image, create prod Cloud Build Trigger on main, scope dev overlay)
- Interpretation: Proceed to update prod overlay to use GAR image oauth-flow:latest, add trigger creation automation, and document dev overlay scope only.
- Actions:
  - Updated prod Terraform image to `${var.region}-docker.pkg.dev/${var.project_id}/bitbrat-services/oauth-flow:latest` in infrastructure/gcp/prod/main.tf
  - Added helper script to create/update Cloud Build Trigger: infrastructure/gcp/scripts/create-cloudbuild-trigger.sh
  - Added planning doc scoping the dev overlay: planning/sprint-2-b7c4a1/dev-overlay-scope.md
- Next input needed:
  - Source repository details for trigger (GitHub owner/repo OR CSR repo), branch pattern (default ^main$), and build SA email (default cloud-build-bb@twitch-452523.iam.gserviceaccount.com).

## 2025-11-07T23:18-05:00 — Prompt ID: req-20251107-close
Prompt
> Sprint complete.

Interpretation
- Close Sprint 2 per Sprint Protocol v2.2: generate verification report, retro, publication metadata; update planning index and key learnings; ensure validation script and artifacts referenced in sprint-manifest.

Actions
- Created `planning/sprint-2-b7c4a1/verification-report.md`.
- Created `planning/sprint-2-b7c4a1/retro.md`.
- Created `planning/sprint-2-b7c4a1/publication.yaml`.
- Updated `planning/index.md` with Sprint 2 section and compare link.
- Appended Sprint 2 learnings to `planning/key-learnings.md`.
- Will update `sprint-manifest.yaml` to reference verification_report, retro, and publication artifacts.

Artifacts
- verification report: planning/sprint-2-b7c4a1/verification-report.md
- retro: planning/sprint-2-b7c4a1/retro.md
- publication: planning/sprint-2-b7c4a1/publication.yaml
