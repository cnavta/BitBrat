# Deliverable Verification Report — Sprint 9 (sprint-9-b9f8c1)

- Source of truth: architecture.yaml
- Report date: 2025-11-14T15:32:00-05:00
- Objective: Network Stack MVP (dev apply capable) and LB scaffolding (dev apply capable, no URL Map import).
- Approved by: chris.navta

## Completed as Implemented
- [x] Network synth produces real Terraform (VPC, Subnet w/ Private Google Access, Router, NAT, baseline firewalls)
- [x] Optional GCS backend (guarded by BITBRAT_TF_BACKEND_BUCKET, disabled in CI)
- [x] Terraform workspace selection per env; outputs capture to outputs.json
- [x] CLI UX improved: streamed Terraform logs; consistent outputs.json even on failures/blocks
- [x] LB synth produces real Terraform (global IP "birtrat-ip", managed cert "bitbrat-dev-cert", stub URL map, HTTPS proxy, global forwarding rule 443, backend service with logging)
- [x] Unit tests pass (as of closure)
- [x] Runbook and evidence template added (network-verify-runbook.md, local-apply-evidence.md)

## Partial or Deferred Items
- [ ] Local apply evidence file populated (operator step, outside CI) — template provided
- [ ] Advanced URL Map YAML generation/import deferred to Sprint 11
- [ ] Serverless NEGs/backend services per service — partial; placeholder default backend included

## Validation Summary
- npm run build — success
- npm test — success
- bash planning/sprint-9-b9f8c1/validate_deliverable.sh — success

## Additional Observations
- Apply is blocked in CI by design; local apply of network and lb works when prerequisites are met and run locally.
- Dev-only names are honored for IP and certificate per instruction.
