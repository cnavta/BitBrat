# Sprint 2 Retrospective — oauth-flow CI/CD + Cloud Run

Sprint ID: sprint-2-b7c4a1
Date: 2025-11-07
Role: Cloud Architect

## Goals Recap
- Deliver CI/CD pipeline (Cloud Build → GAR) and IaC to deploy oauth-flow to Cloud Run (dry-run allowed)
- Wire Secret Manager and least-privilege IAM
- Keep unauthenticated ingress temporarily for this sprint; prepare for VPC/LB next sprint

## What Went Well
- Terraform modules composed cleanly: repo, service accounts + IAM, secrets, Cloud Run
- Build pipeline now tests, compiles, and publishes both :$SHORT_SHA and :latest
- Single deploy entrypoint (infrastructure/deploy-cloud.sh) simplified operator workflows
- Idempotent helper scripts reduced toil: secret import, SA grants, trigger creation, deletion-protection fix

## What Was Hard
- Cloud Run deletion_protection blocked destroy on tainted resources; required untaint/targeted-apply workaround
- Cloud Build GitHub trigger creation UX was brittle (connection vs owner/repo, branch regex, global location)
- Using a non-existent image initially tainted the service; switched temporarily to a public image and then to GAR

## Improvements for Next Sprint
- Switch Cloud Run to internal-only ingress; remove unauthenticated access
- Introduce External/Internal HTTPS Load Balancers with managed certs and Cloud Armor
- Pin secret versions in Terraform (no :latest) and add rotation guidance
- Add deploy-by-digest and promotion/rollback flow in triggers

## Action Items
- Create networking Terraform modules (VPC, SVPC connector, NAT, LB external/internal)
- Add monitoring dashboards and alerting for oauth-flow
- Finalize Cloud Build trigger using GitHub App repository resource; document connection discovery in runbook

## DoD Check
- Code quality aligned to architecture.yaml and TypeScript standards: yes
- Unit tests added and passing for health endpoints: yes
- Deployment artifacts present (Dockerfile, cloudbuild.yaml, Terraform modules): yes
- Documentation and traceability: planning artifacts updated, request log maintained: yes
- Publication artifacts prepared: publication.yaml (PR link/metadata) created: yes

## Risks / Notes
- Temporary unauthenticated ingress must be removed promptly next sprint
- Ensure DNS and domain ownership are ready for managed cert issuance
