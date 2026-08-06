# Implementation Plan – sprint-217-e2f1a3

## Objective
Restore functionality to the BitBrat Platform by recovering accidentally overwritten service implementation files and preventing future regressions in the bootstrapping script.

## Scope
- Restore 9 core service implementation files in `src/apps/` from git history.
- Update `infrastructure/scripts/bootstrap-service.js` to include a safety check that prevents overwriting non-stub code.
- Verify that `ingress-egress` and other services are functional.

## Deliverables
- Restored `src/apps/ingress-egress-service.ts`
- Restored `src/apps/auth-service.ts`
- Restored `src/apps/command-processor-service.ts`
- Restored `src/apps/event-router-service.ts`
- Restored `src/apps/llm-bot-service.ts`
- Restored `src/apps/persistence-service.ts`
- Restored `src/apps/scheduler-service.ts`
- Restored `src/apps/oauth-service.ts`
- Restored `src/apps/api-gateway.ts`
- Modified `infrastructure/scripts/bootstrap-service.js` with safety guards.

## Acceptance Criteria
- `ingress-egress` service is restored with its real implementation (Twitch connectivity, etc.).
- `npm run bootstrap:service -- --name <service> --force` does NOT overwrite a restored service file if it doesn't look like a stub.
- Project builds successfully (`npm run build`).
- Existing unit tests pass (`npm test`).

## Testing Strategy
- Manual verification of restored file contents.
- Run `npm test` to verify functional correctness.
- Test the new safety check in `bootstrap-service.js` by attempting to bootstrap a restored service with `--force`.

## Deployment Approach
- Local changes only. No cloud deployment required.

## Dependencies
- Git history as the source for restoration.

## Definition of Done
- All files restored and verified.
- Safety check implemented and tested.
- `validate_deliverable.sh` passed.
- Pull Request created.
