# Execution Plan – sprint-230-e4f1a2

## Objective
Implement the comprehensive refactor of `InternalEventV2` and remove `InternalEventV1` as specified in the Technical Architecture.

## Phased Approach

### Phase 1: Core Type Refactor
- Update `src/types/events.ts` to the new schema.
- Remove `InternalEventV1` and `EnvelopeV1` definitions.
- This will cause widespread compilation errors, which we will resolve in subsequent phases.

### Phase 2: Common Library Update
- Update `src/common/events/adapters.ts`: Remove V1 conversion logic.
- Update `src/common/base-server.ts`: Remove V1 detection and auto-conversion in `onMessage`.
- Update `src/common/events/attributes.ts`: Align attribute extraction with the new root properties.

### Phase 3: Ingress Services Migration
- Update `src/services/api-gateway/ingress.ts`.
- Update `src/services/ingress/twitch/`.
- Update `src/services/ingress/discord/`.
- Ensure all map to `ingress` and `identity.external`.

### Phase 4: Auth Service & Enrichment Migration
- Update `src/services/auth/enrichment.ts` to use `identity.external` as the source for enrichment.
- Update mapping functions (Twitch, Discord, Twilio).

### Phase 5: Routing & Processing Migration
- Update `src/services/routing/router-engine.ts`.
- Update `src/services/router/jsonlogic-evaluator.ts` (Context mapping).
- Update `src/services/llm-bot/processor.ts`.

### Phase 6: Egress Services Migration
- Update `src/services/api-gateway/egress.ts`.
- Update downstream delivery logic to use `identity.user` or `identity.external`.

### Phase 7: Validation & Cleanup
- Fix all remaining test failures.
- Remove any lingering `InternalEventV1` references in documentation or comments.
- Run `validate_deliverable.sh`.

## Risks & Mitigations
- **Risk**: "Big Bang" refactor makes the codebase unbuildable for a long period.
- **Mitigation**: Work in a strictly ordered sequence; use `tsc --noEmit` to find errors; focus on one service at a time.
- **Risk**: JsonLogic rules in database might break.
- **Mitigation**: Update `jsonlogic-evaluator.ts` to provide a backward-compatible context if possible, or accept that rules need updating (Architect decision: update the evaluator to map new paths to the logic context).
