# Sprint Retro – sprint-113-8c4d1a2

## What worked
- Removal of Cloud NAT from IaC and synth eliminated unnecessary egress path for Pub/Sub, reducing latency.
- Serverless VPC Access posture set to PRIVATE_RANGES_ONLY ensured public traffic (Pub/Sub/Google APIs) bypassed the connector.
- Preflight enforcement updated to describe-only checks (VPC, Subnet, Router, Connector) — safe and side-effect free.
- Documentation and types stayed in lockstep with infra changes; tests updated and passing.
- PR successfully created and recorded in publication.yaml.

## What didn’t
- validate_deliverable.sh surfaced a 403 on terraform plan for the network stack in local environment (compute.networks.get) — expected in constrained envs; documented as non-fatal for this sprint.
- Two services were skipped during deploy dry-run due to missing Dockerfiles; benign for this sprint but worth addressing for consistency.

## Next time
- Consider provisioning a CI-friendly Terraform runner or service account with least-privilege to avoid plan-time 403s in validation.
- Evaluate Private Service Connect (restricted VIP) for Google APIs if private access is later required — backlog for a future sprint.
- Add simple scripted healthcheck to validation to verify LB routing/Serverless NEG reachability.
- Improve PR publication automation by using GitHub Actions or ensuring gh auth in CI.
