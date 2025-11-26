# Implementation Plan — IaC Orchestration CLI (brat)

Sprint: sprint-4-b5a2d1
Owner: Cloud Architect
Status: Proposed (awaiting approval)

## Objective & Scope
Design and plan the migration from `infrastructure/deploy-cloud.sh` to a unified TypeScript CLI that orchestrates build, test, and deploy across local (Docker Compose) and remote (GCP) environments, with future-proofing for VPC, load balancers, and broader IaC.

## Deliverables
- Architecture document (this sprint)
- CLI scaffolding plan and command taxonomy
- Validation script for this sprint

## Acceptance Criteria
- Architecture approved by stakeholders
- Plan lists all parity features present in deploy-cloud.sh with mapped CLI responsibilities
- Testing strategy identified; CI calling pattern documented
- Packaging boundary explicitly documented: brat source/binaries are excluded from all deployable service/runtime artifacts; brat is distributed only as a standalone CLI (Docker image and/or Node entrypoint) and invoked by CI.

## Dependencies & Constraints
- architecture.yaml is canonical; env overlays under env/**
- Secrets creation/import: disabled by policy; only version resolution and verification allowed
- Terraform is present and trusted; CDKTF will be additive

## Parity Feature Mapping
- Flags and global config → oclif flags + zod schema
- Single vs Multi-service → deploy services [names|--all]
- Concurrency → p-limit with default from architecture.yaml
- Env loading → loader.ts reading env/<name> and .env.<name>, with key selection
- Secrets mapping → secrets resolve/check; env KV filtering
- Cloud Build → providers/gcp/cloudbuild.ts with substitutions parity
- Dockerfile inference → same conventions as current script
- Terraform → providers/terraform.ts wrapper for init/validate/plan/apply
- Trigger management → trigger commands with SDK or gcloud fallback
- Deletion protection helper → infra helper command wrapping existing script

## Testing Strategy
- Unit tests for config loader, env key selection, secret resolution, and Dockerfile inference
- Integration tests (dry-run) to verify command graphs and substitutions produced
- Golden tests comparing CLI generated substitutions vs current script for a fixture architecture.yaml

## Deployment Approach
- Package CLI via npm scripts; and package brat as a Docker image for hermetic CI execution
- Cloud Build to call brat commands for deployments
- Proposed image: `us-central1-docker.pkg.dev/$PROJECT_ID/tools/brat:$TAG` (TAG = git short SHA or timestamp)

## Phases & Tasks
1. Scaffold CLI project structure (no behavior changes):
   - oclif init under src/cli with tsconfig adjustments
   - pino logger, zod schemas, yaml loader
   - Basic commands: doctor, config:validate/show
2. Implement deploy services (parity):
   - Load services from architecture.yaml
   - Resolve env keys and secrets mapping
   - Build substitutions and execute gcloud builds submit (dry-run capable)
   - Concurrency with p-limit; per-service logs and summary
3. Implement infra plan/apply:
   - Terraform adapter with init/validate/plan/apply
   - Wire `--dry-run` to plan-only
4. Introduce secrets resolve/check and env filtering utilities
5. Add trigger management commands
6. Add CDKTF skeleton for network module (no-op apply this sprint)
7. CI integration docs and sample cloudbuild yaml calling CLI

## Definition of Done
- planning artifacts present under planning/sprint-4-b5a2d1
- validate_deliverable.sh runs npm ci, build, test successfully
- Stakeholder sign-off on architecture and plan prior to coding
