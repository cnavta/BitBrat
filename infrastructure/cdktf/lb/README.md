# Load Balancer (CDKTF)

This directory holds documentation and entry-points for the BitBrat HTTPS Load Balancer stack. Terraform for this stack is synthesized by the brat CLI into `infrastructure/cdktf/out/load-balancer` and then executed via Terraform.

Components (synthesized):
- Global IP and Managed SSL Certificate (create or use-existing)
- Serverless NEGs and Backend Services for Cloud Run backends
- Target HTTPS Proxy and Global Forwarding Rule
- URL Map (advanced configuration is managed via YAML-first import)

YAML-first URL Map
- Desired state is rendered from `architecture.yaml` using the brat generator
- Guarded import performs: describe → normalize → diff → conditional `gcloud import`
- Terraform owns only the URL map stub (name) with `lifecycle.ignore_changes` on provider-managed fields

Commands
- Dry-run plan: `npm run brat -- infra plan lb --dry-run`
- Render URL map: `npm run brat -- lb urlmap render --env dev`
- Import URL map (dry-run): `npm run brat -- lb urlmap import --env dev --dry-run`
- Apply LB (local only) then auto-import (non-prod): `npm run brat -- infra apply lb --env dev`

CI
- Cloud Build runs render and import (dry-run) for env=dev to detect drift

Notes:
- Apply is guarded and not used in CI.
- In prod, import never runs automatically; review diff and import manually.
