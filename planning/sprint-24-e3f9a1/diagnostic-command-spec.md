# Spec — Diagnostic Command to List Derived Backends from Routing

Sprint: sprint-24-e3f9a1
Owner: Lead Implementor
Source: architecture.yaml; upstream Sprint 17 plans

## Command
```
npm run brat -- diag backends --env <env> --project-id <id> [--format json|table] [--lb <resourceKey>]
```

## Purpose
Enumerate the set of backend services implied by `infrastructure.resources.<lb>.routing` for visibility and troubleshooting.

## Behavior
- Reads architecture.yaml and resolves the active environment overlay.
- Locates all resources of `type: load-balancer` with `implementation: global-external-application-lb`.
- For each (or a specific one via `--lb`):
  - Derives unique referenced services from routing rules.
  - Detects whether any bucket routes or `default_bucket` exist; if so, includes `assets-proxy` as a required backend.
  - Emits an ordered list of backend identifiers with metadata.

## Output
When `--format json` (default):
```json
{
  "loadBalancers": [
    {
      "key": "public-lb",
      "defaultDomain": "example.com",
      "requiresAssetsProxy": true,
      "services": ["oauth-flow", "ingress-egress"],
      "backends": [
        { "name": "be-oauth-flow", "type": "service", "regions": ["us-central1"] },
        { "name": "be-ingress-egress", "type": "service", "regions": ["us-central1"] },
        { "name": "be-assets-proxy", "type": "assets-proxy", "regions": ["us-central1"] }
      ]
    }
  ]
}
```

When `--format table`:
```
LB           TYPE          BACKEND            REGIONS
public-lb    service       be-oauth-flow      us-central1
public-lb    service       be-ingress-egress  us-central1
public-lb    assets-proxy  be-assets-proxy    us-central1
```

## Flags
- `--lb <resourceKey>`: Limit output to a specific load balancer resource key.
- `--format <json|table>`: Output format. Default `json` for CI friendliness.
- `--env <env>` and `--project-id <id>`: Standard environment selection flags.

## Exit Codes
- 0: Success
- 2: Invalid configuration (e.g., rule with both service and bucket)
- 3: Requested `--lb` not found

## Notes
- Read-only, no cloud calls required.
- Useful in CI to assert parity between routing and synthesized backends.
