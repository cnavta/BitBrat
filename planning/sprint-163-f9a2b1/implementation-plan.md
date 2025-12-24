# Implementation Plan – sprint-163-f9a2b1

## Objective
Update the `brat` deployment tool to provision a regional internal load balancer and internal DNS for the BitBrat VPC, enabling service-to-service communication via `{service-name}.bitbrat.local`.

## Scope
- Update `brat` tool's CDKTF synthesizer to support:
  - Proxy-only subnet (required for regional internal application load balancers).
  - Private DNS zones (`bitbrat.internal` and `bitbrat.local`).
  - Regional internal application load balancer (ILB).
  - Serverless NEGs for each service in the internal LB.
  - DNS A records pointing to the ILB's internal IP.
- Update `architecture.yaml` schema to include the new load balancer type.
- Update `architecture.yaml` to define the internal load balancer.

## Deliverables
- Code changes in `tools/brat`:
  - `src/config/schema.ts`: Add `regional-internal-application-lb` support.
  - `src/providers/cdktf-synth.ts`: Update `synthNetworkTf` and implement/update load balancer synthesis for internal LB.
- Updated `architecture.yaml` (optional but recommended for verification).
- `validate_deliverable.sh` script to verify the synthesis.

## Acceptance Criteria
- `brat` tool successfully synthesizes Terraform code for:
  - A VPC with a proxy-only subnet in the configured region.
  - A private DNS zone `bitbrat.internal`.
  - A private DNS zone `bitbrat.local`.
  - A regional internal application load balancer.
  - Backend services and Serverless NEGs for all active services.
  - DNS A records for `{service}.bitbrat.local` pointing to the ILB IP.
- The synthesized Terraform code is valid (passes `terraform validate`).

## Testing Strategy
- Unit tests for the synthesizer changes in `tools/brat/src/providers/cdktf-synth.spec.ts` (or equivalent).
- E2E-style validation using `validate_deliverable.sh` to run `brat` and then `terraform validate` on the output.

## Deployment Approach
- The `brat` tool is used to generate Terraform, which is then applied (outside the scope of this sprint's automated tests, but part of the tool's usage).

## Dependencies
- GCP Project with Compute Engine and Cloud DNS APIs enabled.
- Terraform CLI.

## Definition of Done
- All code changes implemented.
- Tests passing.
- `validate_deliverable.sh` successful.
- Documentation updated (this plan and verification report).
- PR created.

---

## Technical Architecture

### 1. Network Enhancements
- **Proxy-Only Subnet**: A regional internal application load balancer requires a subnet with `purpose = "REGIONAL_MANAGED_PROXY"` and `role = "ACTIVE"`. We will use `10.129.0.0/23` as a default.
- **Private DNS Zones**:
  - `bitbrat.internal`: Primary internal zone for the VPC.
  - `bitbrat.local`: Zone for service discovery, mapping `{service}.bitbrat.local` to the ILB IP.

### 2. Regional Internal Load Balancer
- **Internal IP**: Reserve a regional internal IP address for the load balancer.
- **Backend Services**: Create `google_compute_region_backend_service` for each service with `load_balancing_scheme = "INTERNAL_MANAGED"`.
- **Serverless NEGs**: Create `google_compute_region_network_endpoint_group` for each service.
- **URL Map**: Create `google_compute_region_url_map` with host rules for all active services.
- **Target Proxy**: Create `google_compute_region_target_http_proxy`.
- **Forwarding Rule**: Create `google_compute_forwarding_rule` with `load_balancing_scheme = "INTERNAL_MANAGED"`, referencing the internal IP and target proxy.

### 3. DNS Integration
- For each service `svc`, create a DNS record `svc.bitbrat.local` pointing to the ILB internal IP.

### 4. Brat Tool Implementation Details
- **Schema Update**: Add `regional-internal-application-lb` to `ArchitectureSchema`.
- **Synth Network**:
  - Add proxy-only subnet resource.
  - Add `google_dns_managed_zone` resources.
- **Synth Load Balancer**:
  - Detect `regional-internal-application-lb` implementation.
  - Generate the regional internal resources listed above.
  - Loop through all active services to create NEGs and backends.
