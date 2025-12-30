# Implementation Plan – sprint-184-lb-align

## Objective
- Eliminate the creation of duplicate Load Balancer resources by aligning naming conventions between the CDKTF synthesis and the BRAT CLI management commands.

## Scope
- BRAT CLI `lb urlmap render` and `lb urlmap import` commands.
- URL Map renderer logic.
- CDKTF synthesis naming logic.

## Deliverables
- Code changes in `tools/brat/src/cli/index.ts`, `tools/brat/src/lb/urlmap/renderer.ts`, and `tools/brat/src/lb/urlmap/schema.ts`.
- Updated unit tests for renderer and importer.
- Regenerated `infrastructure/cdktf/lb/url-maps/dev/url-map.yaml`.

## Acceptance Criteria
- `npm run brat -- lb urlmap render` produces a YAML with the name specified in `architecture.yaml`.
- `npm run brat -- lb urlmap import` uses the name from `architecture.yaml`.
- No more hardcoded `bitbrat-global-url-map` where dynamic names are expected.
- All tests pass.

## Testing Strategy
- Run unit tests for renderer and importer.
- Run CDKTF synthesis tests.
- Verify generated YAML files.

## Definition of Done
- All code changes pushed to feature branch.
- PR created.
- Verification report and retro completed.
