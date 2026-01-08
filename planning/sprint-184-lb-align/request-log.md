# Request Log – sprint-184-lb-align

## 2025-12-30T13:51:00Z
- **Prompt**: Investigating 2 Global External LBs being created.
- **Analysis**: Found hardcoded `bitbrat-global-url-map` in `cli/index.ts` and `renderer.ts`.
- **Action**: Modified `schema.ts`, `renderer.ts`, and `cli/index.ts` to use dynamic naming from `architecture.yaml`.
- **Files Modified**:
    - `tools/brat/src/lb/urlmap/schema.ts`
    - `tools/brat/src/lb/urlmap/renderer.ts`
    - `tools/brat/src/cli/index.ts`
    - `tools/brat/src/lb/urlmap/__tests__/renderer.test.ts`
    - `tools/brat/src/lb/importer/__tests__/importer.test.ts`
    - `tools/brat/src/lb/importer/__tests__/importer.guard.test.ts`
    - `tools/brat/src/lb/urlmap/__tests__/renderer.routing.test.ts`
    - `infrastructure/cdktf/lb/url-maps/dev/url-map.yaml` (regenerated)
