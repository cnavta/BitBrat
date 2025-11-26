# Cloud Build Trigger — Infra Plan Job (PR validation)

This document explains how to configure a Cloud Build trigger to run the non-destructive infrastructure planning pipeline defined in `cloudbuild.infra-plan.yaml` on Pull Requests.

## Overview
- Pipeline file: `cloudbuild.infra-plan.yaml`
- Behavior: Runs in dry-run mode, performs tooling checks, enables APIs (dry-run), and runs `infra plan` for network, connectors, and load balancer, followed by a URL map import dry-run. No resources are applied.
- Inputs (substitutions):
  - `_ENV` — environment overlay to use (default: `dev`)
  - `_PROJECT_ID` — target GCP project (default: `$PROJECT_ID` from Cloud Build context)

## Required permissions
- Cloud Build service account must have permissions to run terraform plan (read/list) and to describe/load URL maps in dry-run. No write permissions are required for this job.

## Create the PR trigger (GitHub)
Example uses a GitHub App connection and triggers on Pull Requests that touch `cloudbuild.infra-plan.yaml` or infra code.

```bash
# Variables
PROJECT_ID="<YOUR_PROJECT_ID>"
REGION="us-central1"
REPO_OWNER="cnavta"
REPO_NAME="BitBrat"
CONNECTION="github-conn"

# Create the trigger (PR-based)
gcloud beta builds triggers create github \
  --name="infra-plan-pr" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --repo-owner="${REPO_OWNER}" \
  --repo-name="${REPO_NAME}" \
  --pull-request-pattern=".*" \
  --build-config="cloudbuild.infra-plan.yaml" \
  --substitutions="_ENV=dev,_PROJECT_ID=${PROJECT_ID}"
```

Notes:
- You can scope the trigger to specific branches using `--pull-request-branch`.
- You can override `_ENV` to `staging` or `prod` when needed. For prod, this pipeline still runs in dry-run.

## Local parity
Run the same steps locally using the root validator:

```bash
./validate_deliverable.sh --env dev --project-id <YOUR_PROJECT_ID>
```

This executes the same dry-run `brat` commands as the CI pipeline, after install/build/test steps.
