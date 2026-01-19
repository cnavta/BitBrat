# Deliverable Verification – sprint-195-b5a2c1

## Completed
- [x] Create missing `env/local/` YAML files for `auth`, `event-router`, `persistence`, and `scheduler`.
- [x] Update `.env.example` with accurate local setup instructions and mandatory secrets.
- [x] Fix `merge-env.js` to prevent global `SERVICE_NAME` collision.
- [x] Remove redundant `SERVICE_NAME` from `env/local/oauth-flow.yaml`.
- [x] Update `README.md` with clarified environment setup and log viewing steps.
- [x] Implement `npm run local:logs` command in `package.json` and `deploy-local.sh`.
- [x] Verify `npm run local -- --dry-run`, `npm run local:logs -- --dry-run`, and infra dry-runs.

## Partial
- None

## Deferred
- None

## Alignment Notes
- `SERVICE_PORT` remains as a global default in `merge-env.js` as it is typically 3000 for all internal containers.
- Documentation now explicitly mentions the need for absolute paths for `GOOGLE_APPLICATION_CREDENTIALS`.
