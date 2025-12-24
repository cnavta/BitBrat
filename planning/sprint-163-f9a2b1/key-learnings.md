# Key Learnings – sprint-163-f9a2b1

## Regional Internal Application Load Balancer
- Requires a `REGIONAL_MANAGED_PROXY` subnet.
- Backend services must have `load_balancing_scheme = "INTERNAL_MANAGED"`.
- Uses `google_compute_region_url_map` instead of `google_compute_url_map`.

## Cloud DNS Private Zones
- Private zones must be associated with the VPC network.
- Record sets in private zones are only resolvable from within the associated VPC.

## Brat Tool Evolution
- Moving towards resource-driven synthesis in `brat` (iterating over `infrastructure.resources`) makes the tool much more extensible than the previous hardcoded `arch.lb` approach.
