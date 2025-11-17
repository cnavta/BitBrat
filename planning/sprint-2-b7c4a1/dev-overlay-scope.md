# Dev Overlay Scope (Draft)

Objective
- Define the minimal Terraform overlay for the dev project (bitbrat-local) that mirrors the prod oauth-flow stack while preserving the future VPC/LB direction.

Assumptions
- Project ID: bitbrat-local
- Region: us-central1
- Same Artifact Registry repo name: bitbrat-services
- Same secret IDs exist in Secret Manager: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OAUTH_STATE_SECRET
- Temporary unauthenticated Cloud Run ingress (to be restricted in a later sprint)

Deliverables (when approved)
- infrastructure/gcp/dev/
  - providers.tf (google provider pinned as in prod)
  - variables.tf (project_id, region)
  - main.tf reusing existing modules:
    - modules: artifact-registry-repo, service-accounts, secrets (import step), cloud-run-service
    - image: ${region}-docker.pkg.dev/${project_id}/bitbrat-services/oauth-flow:latest
    - deletion_protection = false initially for iteration; enable later
- Scripts
  - Reuse: infrastructure/gcp/scripts/import-existing-secrets.sh
  - Reuse: infrastructure/gcp/scripts/grant-tf-sa-perms.sh

Open Questions
- Should dev push on every commit to main, or use a separate branch strategy?
- Do we want a separate dev Artifact Registry repo (e.g., bitbrat-services-dev) to reduce confusion, or reuse the same repo with per-project paths?
- Any deviation in scaling or CPU/memory for dev?

Out-of-Scope (kept in mind)
- VPC, Serverless VPC Access, and Internal-only ingress will be added next sprint across envs.

Next Steps (if approved)
1. Create dev overlay with the same module wiring as prod.
2. Run terraform init/validate/plan for dev. 
3. Decide on a dev build trigger (optional this sprint) mapping to the dev project.
