# Assets Proxy Expectations — Naming and IAM

Sprint: sprint-24-e3f9a1
Source of Truth: architecture.yaml
Upstream: planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md

## Purpose
Document expectations for the assets-proxy used to serve bucket routes under the External Managed Application Load Balancer (ALB).

## Naming Convention
- Cloud Run service name: `assets-proxy`
- Backend service name (synthesized): `be-assets-proxy`
- Serverless NEG per region targets the Cloud Run `assets-proxy` service

## URL Map Contract
- Bucket rules and defaults are routed to `be-assets-proxy`.
- URL map renderer injects a urlRewrite that encodes the bucket key in the request path, e.g. `/bucket/<bucketKey>/...`.
- The proxy must parse the bucket key and fetch the corresponding object from GCS.

## IAM Requirements
For private buckets (default):
- The assets-proxy service account must be granted permissions to read objects:
  - `roles/storage.objectViewer` on the target bucket(s)
  - Alternatively, granular IAM such as `storage.objects.get` via IAM Conditions

For public buckets:
- No additional IAM is required for object reads; ensure `uniform bucket-level access` is enabled and a binding exists for `allUsers: roles/storage.objectViewer`.
- The proxy may still be used for consistent routing and caching semantics.

## Recommended Setup Steps
1. Ensure a Cloud Run service named `assets-proxy` is deployed in the target project/region(s).
2. Grant IAM to the service account:
   ```bash
   gcloud storage buckets add-iam-policy-binding gs://<bucket-name> \
     --member "serviceAccount:<SERVICE_ACCOUNT_EMAIL>" \
     --role roles/storage.objectViewer
   ```
3. Verify routing:
   - Include a bucket rule in `infrastructure.resources.<lb>.routing.rules` or set `default_bucket`.
   - Run CI or `./validate_deliverable.sh` to confirm URL map generation and LB plan.

## Notes
- The assets-proxy is not provisioned by this repository in Sprint 24; only expectations are documented.
- Classic backend buckets for the Classic LB path remain out of scope; ALB path uses the proxy by default.
