# Deliverable Verification – sprint-212-f4b9e2

## Completed
- [x] Identified that `environment:` mapping in `compose.yaml` using `- VAR` (list style without value) fails to resolve variables from `.env.local` unless they are exported in the host shell.
- [x] Updated `infrastructure/scripts/bootstrap-service.js` to use explicit mapping `- VAR=${VAR}` in the `environment:` section.
- [x] Regenerated all service compose files in `infrastructure/docker-compose/services/`.
- [x] Verified fix with `validate_deliverable.sh`.

## Partial
None.

## Deferred
None.

## Alignment Notes
- This fix ensures that variables from `.secure.local` (which are merged into `.env.local`) are correctly passed to both image-only and entry-based services when running locally.
- The use of `${VAR}` in the compose file relies on the `--env-file .env.local` flag already used in `deploy-local.sh` for interpolation.