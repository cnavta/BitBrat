# Retro – sprint-163-f9a2b1

## What Worked
- Refactoring `synthLoadBalancerTf` to iterate over resources allowed easy addition of the internal load balancer.
- Reusing `deriveUniqueServices` logic ensured consistency in which services are exposed.
- `validate_deliverable.sh` provided quick feedback on the validity of the synthesized Terraform.

## What Didn't Work
- Initial `validate_deliverable.sh` used `node` with `dist` paths, which required a build. Switching to `ts-node` was faster.
- Hardcoding `managed_zone = "bitbrat-local"` in the LB module creates a dependency on the network module's naming convention, which is currently acceptable but could be more robust.

## Next Steps
- Implement HTTPS for the internal load balancer if encryption in transit within the VPC becomes a requirement.
- Consider making the DNS zone name configurable in `architecture.yaml`.
