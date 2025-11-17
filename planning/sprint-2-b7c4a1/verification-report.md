# Deliverable Verification Report — Sprint 2 (sprint-2-b7c4a1)

Date: 2025-11-07
Service: oauth-flow
Project (prod): twitch-452523
Region: us-central1

## Completed as Implemented
- [x] Cloud Build pipeline for oauth-flow
  - Runs npm ci, tests, build, docker build, and pushes images tagged with $SHORT_SHA and latest
  - Supports deploy step with --dry-run toggle via _DRY_RUN substitution
  - Config file: cloudbuild.oauth-flow.yaml
- [x] Artifact Registry (GAR) repository
  - us-central1, name: bitbrat-services
  - Image path used by build and Terraform: us-central1-docker.pkg.dev/$PROJECT_ID/bitbrat-services/oauth-flow
- [x] Secret Manager adoption and runtime wiring
  - Secrets exist: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET
  - Adopted into Terraform state via infrastructure/gcp/scripts/import-existing-secrets.sh
  - Mounted into Cloud Run as environment variables (version: latest for this sprint)
- [x] IAM and Service Accounts
  - Runtime SA: run-oauth-flow
  - Build SA: cloud-build-bb (writer to GAR, run.admin; SA User on runtime SA)
  - Terraform SA permissions script provided: infrastructure/gcp/scripts/grant-tf-sa-perms.sh
- [x] Cloud Run v2 service (oauth-flow)
  - Image: ${region}-docker.pkg.dev/${project_id}/bitbrat-services/oauth-flow:latest
  - CPU=1, Memory=512Mi, min=0, max=3, port=3000
  - Ingress=all; unauthenticated allowed (temporary for this sprint)
  - Deletion protection set false during iteration to avoid apply blocks
- [x] Tests for health endpoints and build pipeline
  - Jest tests for /healthz, /readyz, /livez pass locally and in Cloud Build
- [x] Validation script
  - planning/sprint-2-b7c4a1/validate_deliverable.sh supports plan/apply and optional Cloud Build submission
- [x] Single entrypoint deploy script
  - infrastructure/deploy-cloud.sh orchestrates secret import, Terraform plan/apply, optional trigger creation, and deletion-protection fix

## Partial or Mock Implementations
- [ ] Cloud Build Trigger (GitHub App)
  - Creation is automated via infrastructure/gcp/scripts/create-cloudbuild-trigger.sh and deploy-cloud.sh --create-trigger
  - Action: Run trigger creation once with your connection/repo to finalize; see script help for flags
- [ ] Publication (Pull Request)
  - publication.yaml created with compare-link; PR must still be opened in GitHub and reviewed

## Additional Observations
- Unauthenticated access and ingress=all are intentionally enabled for this sprint only; to be locked down next sprint with VPC + Load Balancers
- Adopted a temporary public image earlier to work around revision failures while unblocking Terraform; now replaced by GAR image
- Cloud Run deletion_protection can block destroys when resources get tainted; provided script to untaint and update in-place

## Verification Evidence (pointers)
- Cloud Build: cloudbuild.oauth-flow.yaml
- Terraform modules and prod overlay under infrastructure/gcp/
- Secret import script: infrastructure/gcp/scripts/import-existing-secrets.sh
- Deploy orchestrator: infrastructure/deploy-cloud.sh
- Tests: src/apps/oauth-service.test.ts
