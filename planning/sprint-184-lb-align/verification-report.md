# Deliverable Verification – sprint-184-lb-align

## Completed
- [x] Removed hardcoded `bitbrat-global-url-map` from `tools/brat/src/cli/index.ts`.
- [x] Removed hardcoded `bitbrat-global-url-map` from `tools/brat/src/lb/urlmap/renderer.ts`.
- [x] Updated `RendererInputSchema` to include dynamic `name`.
- [x] Updated all relevant unit tests to include the `name` property.
- [x] Regenerated `infrastructure/cdktf/lb/url-maps/dev/url-map.yaml` with the correct name.
- [x] Verified that `lb urlmap render` correctly picks up the name from `architecture.yaml`.

## Partial
- None

## Deferred
- None

## Alignment Notes
- The default name remains `bitbrat-global-url-map` if not specified in `architecture.yaml` to ensure backward compatibility.
