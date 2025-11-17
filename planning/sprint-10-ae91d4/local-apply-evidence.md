# Local Apply Evidence — Connectors (Deferred)

Date: 2025-11-14
Status: Deferred to next sprint (operational step)

This file will capture logs and artifacts from a non-CI local apply of the Serverless VPC Access connectors module.

Planned procedure:
1. Ensure CI is not set in the shell and credentials are configured
   - unset CI
   - export GOOGLE_APPLICATION_CREDENTIALS=<path-to-tf-sa-json>
   - export PROJECT_ID=<your-project>
2. Plan (safe):
   - npm run brat -- infra plan connectors --env=dev --project-id "$PROJECT_ID"
3. Apply (local only; not in CI; do not pass --dry-run):
   - npm run brat -- infra apply connectors --env=dev --project-id "$PROJECT_ID"
4. Evidence to attach here:
   - Tail of apply logs indicating resource creation/updates
   - infrastructure/cdktf/out/connectors/outputs.json
   - gcloud describes for connector:
     - gcloud compute networks vpc-access connectors describe brat-conn-<region>-dev --region <region> --project $PROJECT_ID

Notes:
- Ensure vpcaccess.googleapis.com API is enabled before apply.
- Default connector CIDR is /28 and should be unique per region.
