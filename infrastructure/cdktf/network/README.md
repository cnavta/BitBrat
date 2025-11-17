# Network (CDKTF) — Scaffold

This directory will hold the CDK for Terraform (CDKTF) implementation for the BitBrat network stack:
- VPC (custom mode)
- Subnets per region
- Cloud Router/NAT
- Baseline firewall

For now, this is a placeholder directory. The actual Terraform to plan/apply is synthesized by the brat CLI into infrastructure/cdktf/out/network.

Usage (dry-run):
- npm run brat -- infra plan network --dry-run

Notes:
- No resources are applied during dry-run. Apply is guarded and not used in CI.
