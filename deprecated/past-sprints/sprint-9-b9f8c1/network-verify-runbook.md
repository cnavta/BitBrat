# Network Stack Verification Runbook (Dev)

Sprint: sprint-9-b9f8c1
Source of truth: architecture.yaml
Scope: Post-apply verification for Network MVP (VPC, Subnet with Private Google Access, Cloud Router, Cloud NAT, baseline firewalls)

Prereqs
- gcloud CLI authenticated to the target project
- Terraform applied locally via: `npm run brat -- infra apply network --env=dev --project-id <PROJECT>`
- Region: from architecture.yaml (default us-central1 unless overridden)

Env variables (example)
- export PROJECT_ID="<PROJECT>"
- export REGION="us-central1"

Verification steps
1) VPC exists
- gcloud compute networks describe brat-vpc --project "$PROJECT_ID" --format yaml

2) Subnet exists with Private Google Access
- gcloud compute networks subnets describe brat-subnet-${REGION}-dev \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format yaml
- Confirm: privateIpGoogleAccess: true

3) Cloud Router exists
- gcloud compute routers describe brat-router-${REGION} \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format yaml

4) Cloud NAT attached to router
- gcloud compute routers nats describe brat-nat-${REGION} \
    --router brat-router-${REGION} \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format yaml

5) Firewalls present
- gcloud compute firewall-rules list --filter="name~'allow-(internal|health-checks)'" --project "$PROJECT_ID"

6) Terraform outputs captured
- Inspect synthesized outputs file (created by brat after apply):
  - infrastructure/cdktf/out/network/outputs.json

7) Record evidence
- Copy the YAML outputs from the above commands into local-apply-evidence.md under the appropriate sections.

Notes
- Remote state backend (GCS) is optional and guarded via BITBRAT_TF_BACKEND_BUCKET; CI remains plan-only.
- Workspaces: brat selects/creates a Terraform workspace named after the env (e.g., dev).
