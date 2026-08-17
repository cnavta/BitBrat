# Deliverable Verification – sprint-216-b2c4d5

## Completed
- [x] Researched `path-to-regexp` v8+ wildcard syntax.
- [x] Updated `src/apps/oauth-service.ts` to use `{ *path }` syntax.
- [x] Updated `infrastructure/scripts/bootstrap-service.js` generator to use `{ *path }` for wildcards.
- [x] Updated `infrastructure/scripts/bootstrap-service.test.js` to match.
- [x] Verified with targeted unit tests.
- [x] Verified with local dry-run for `oauth-flow`.

## Partial
None.

## Deferred
None.

## Alignment Notes
- Confirmed that `{ *path }` is the correct syntax for `path-to-regexp` v8+.
- Previous attempts (`*`, `(.*)`, `:path(.*)`) were all rejected by the newer version of the library.
