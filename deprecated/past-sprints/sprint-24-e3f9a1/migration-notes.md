# Migration Guide — lb.services[] to routing-driven configuration

Sprint: sprint-24-e3f9a1
Source of Truth: architecture.yaml
Upstream: planning/sprint-17-f7c3a2/technical-architecture-lb-routing-from-infrastructure-resources.md

## Overview
This guide explains how to migrate from legacy `lb.services[]` to routing-driven configuration under `infrastructure.resources.<lb>.routing`.

## Why migrate
- Single source of truth for both backends and URL map routing
- Reduced drift and duplication
- Enables bucket routing via the assets-proxy pattern

## Deprecation behavior
- When both mechanisms are present, routing-driven load-balancer takes precedence.
- The CLI emits a deprecation warning: "Deprecation: lb.services[] is ignored when a routing-driven load-balancer resource exists".

## Target data model
In architecture.yaml:
- Define load balancer under `infrastructure.resources` with `type: load-balancer` and `implementation: global-external-application-lb`.
- Provide `routing` with `default_domain`, optional `default_bucket`, and `rules[]` where each rule has `path_prefix` and exactly one of `service` or `bucket`.
- Define buckets as `type: object-store` and `implementation: cloud-storage`.

## Step-by-step migration
1. Inventory routes from your current URL map and `lb.services[]`.
2. Create or update `infrastructure.resources.<lb>` with a `routing` section:
   - Translate service routes to rules with `service: <serviceId>`.
   - Translate static assets routes to rules with `bucket: <bucketKey>`.
   - If most traffic should fall back to assets, set `default_bucket`.
3. Remove or ignore `lb.services[]` entries. They will be ignored when routing is present but should be removed once migration is complete.
4. Ensure each referenced `service` exists under top-level `services` and is active for the target environment.
5. Ensure each referenced `bucket` exists under `infrastructure.resources` as an object-store/cloud-storage entry with desired `access_policy`.
6. Run local validation:
   ```bash
   ./validate_deliverable.sh --env dev --project-id <PROJECT_ID>
   ```
   Confirm buckets and load balancer plan steps succeed in dry-run.
7. Prepare the assets-proxy per the expectations doc if bucket routes are used.

## Examples
Service route:
```yaml
infrastructure:
  resources:
    public-lb:
      type: load-balancer
      implementation: global-external-application-lb
      routing:
        default_domain: example.com
        rules:
          - path_prefix: /api
            service: oauth-flow
```

Bucket route with default bucket:
```yaml
infrastructure:
  resources:
    assets:
      type: object-store
      implementation: cloud-storage
      description: Public static assets
      access_policy: public
    public-lb:
      type: load-balancer
      implementation: global-external-application-lb
      routing:
        default_domain: example.com
        default_bucket: assets
        rules:
          - path_prefix: /assets
            bucket: assets
```

## Timeline
- Phase 1: routing takes precedence; `lb.services[]` allowed but deprecated and ignored.
- Phase 2: remove `lb.services[]` entirely from configs.

## Verification
- CI: cloudbuild.infra-plan.yaml includes a buckets plan step.
- Local: validate_deliverable runs buckets and lb plan steps, then url map import dry-run.

## Notes
- Aligns with Sprint 20–23 schema and synth/renderer/importer changes.
- Use routing-only source; do not rely on `lb.services[]`.
