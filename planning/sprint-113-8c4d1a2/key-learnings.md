Key Learnings – sprint-113-8c4d1a2

- Removing Cloud NAT simplified egress and shaved latency for Pub/Sub by letting Cloud Run use Google-managed public egress by default.
- When a Serverless VPC Access connector is required, setting vpc_egress=PRIVATE_RANGES_ONLY preserves private reachability while keeping public traffic on the fastest path.
- Preconditions in tooling should be describe-only and align with the intended posture; enforcing NAT created unnecessary coupling and deploy failures.
- Validation should tolerate limited local/CI IAM for plan-only runs; document non-fatal 403s and consider a least-privilege SA for Terraform plans.
- Private access to Google APIs can be added later via Private Service Connect if needed; it’s independent of Cloud NAT and compatible with the current posture.
