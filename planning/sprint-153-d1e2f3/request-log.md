# Request Log — sprint-153-d1e2f3

## [2025-12-21T12:28:00Z] Initial Sprint Start
- **Prompt summary**: Start a new sprint to give the platform understanding of Source State (Twitch/Discord). Track status in Firestore.
- **Interpretation**: Architect a solution for source status tracking (Connected/Disconnected, Error, Stats) and stream status (Started/Stopped). Integrate with Twitch EventSub.
- **Shell/git commands executed**:
  - `mkdir -p planning/sprint-153-d1e2f3 && git checkout -b feature/sprint-153-d1e2f3-source-state-architecture`
- **Files modified or created**:
  - `planning/sprint-153-d1e2f3/sprint-manifest.yaml`
  - `planning/sprint-153-d1e2f3/request-log.md`

## [2025-12-21T12:35:00Z] Sprint Execution Planning
- **Prompt summary**: Assume Lead Implementor role, create Execution Plan and Backlog.
- **Interpretation**: Detailed the implementation phases and created a trackable YAML backlog for the sprint.
- **Shell/git commands executed**: None
- **Files modified or created**:
  - `planning/sprint-153-d1e2f3/execution-plan.md`
  - `planning/sprint-153-d1e2f3/backlog.yaml`

## [2025-12-21T13:05:00Z] Remove Periodic Heartbeats
- **Prompt summary**: Remove the heartbeat message that is continually published to reduce Pub/Sub noise.
- **Interpretation**: Disabled the periodic `system.source.status` publication in `ingress-egress-service.ts`.
- **Shell/git commands executed**:
  - `npm run build`
  - `npx jest src/apps/ingress-egress-service.test.ts`
- **Files modified or created**:
  - `src/apps/ingress-egress-service.ts`

## [2025-12-21T13:35:00Z] Fix EventSub Stream Online Crash
- **Prompt summary**: Stream.online events are causing a crash in ingress-egress service due to `toISOString` on undefined.
- **Interpretation**: The EventSub event mapping in `EventSubEnvelopeBuilder` was using the wrong property name (`startedAt` instead of `startDate`). Also, handlers lacked `try-catch` blocks.
- **Shell/git commands executed**:
  - `npx jest src/services/ingress/twitch/__tests__/eventsub-client.repro.spec.ts`
  - `npm run build`
- **Files modified or created**:
  - `src/services/ingress/twitch/eventsub-envelope-builder.ts`
  - `src/services/ingress/twitch/eventsub-client.ts`
  - `src/services/ingress/twitch/__tests__/eventsub-client.repro.spec.ts`

## [2025-12-21T13:50:00Z] Fix Firestore Persistence in Cloud Run
- **Prompt summary**: Source state is not being persisted to Firestore in Cloud Run.
- **Interpretation**: Found that `normalizeStreamEvent` was missing `platform` and `id`, causing `upsertSourceState` to reject it. Also, removing the heartbeat loop removed the only mechanism for `system.source.status` updates.
- **Shell/git commands executed**:
  - `npx jest src/services/persistence/store.spec.ts`
  - `npm run build`
- **Files modified or created**:
  - `src/services/persistence/model.ts`
  - `src/services/persistence/store.spec.ts`
  - `src/apps/ingress-egress-service.ts`
  - `src/services/ingress/twitch/twitch-irc-client.ts`
  - `src/services/ingress/twitch/connector-adapter.ts`

## [2025-12-21T14:20:00Z] Fix EventSub ERROR state in Firestore
- **Prompt summary**: Twitch EventSub source shows ERROR in Firestore with little info, despite working correctly.
- **Interpretation**: The `TwitchEventSubClient` was missing a `state` property in its snapshot, causing the `TwitchConnectorAdapter` to default to `ERROR`. Added state tracking and compatible snapshot fields to `TwitchEventSubClient`.
- **Shell/git commands executed**:
  - `npm run build`
- **Files modified or created**:
  - `src/services/ingress/twitch/eventsub-client.ts`

## [2025-12-21T15:15:00Z] Fix Twitch Bot Token Overwrite
- **Prompt summary**: Twitch bot token's userId repeatedly get overwritten with the broadcaster's ID in Cloud Run. Bot responses are coming from the broadcaster's account.
- **Interpretation**: `FirestoreTwitchCredentialsProvider` was saving all refreshes to the bot store unconditionally. When an aliased bot token (used by EventSub) or a real broadcaster token refreshed, it overwrote the bot's document.
- **Shell/git commands executed**:
  - `npx jest src/services/ingress/twitch/__tests__/token-overwrite.spec.ts`
  - `npm test`
  - `npm run build`
- **Files modified or created**:
  - `src/services/ingress/twitch/credentials-provider.ts`
  - `src/services/ingress/twitch/__tests__/token-overwrite.spec.ts`

## [2025-12-21T15:45:00Z] Adjust Default OAuth Scopes for Twitch Bot
- **Prompt summary**: Adjust the default OAuth claims on the bot to include any that we've added with the new EventSub events.
- **Interpretation**: Updated default scope lists to include `moderator:read:followers` (for `channel.follow` v2) and other required scopes for bot permissions and supported event types (`moderation:read`, `bits:read`, `moderator:read:shoutouts`, `user:read:email`). Added `TWITCH_OAUTH_SCOPES` to `architecture.yaml`.
- **Shell/git commands executed**:
  - `npx ts-node --transpile-only test-scopes.ts`
- **Files modified or created**:
  - `src/services/oauth/providers/twitch-adapter.ts`
  - `src/services/twitch-oauth.ts`
  - `architecture.yaml`
  - `test-scopes.ts` (temp verification script)

## [2025-12-21T15:55:00Z] Fix Infrastructure Test Failure
- **Prompt summary**: Fix test failure in `extract-config.test.ts` due to `TWITCH_OAUTH_SCOPES` addition.
- **Interpretation**: Updated the expected `ENV_KEYS` in `infrastructure/scripts/extract-config.test.ts` to include the newly added environment variable.
- **Shell/git commands executed**:
  - `npx jest infrastructure/scripts/extract-config.test.ts`
- **Files modified or created**:
  - `infrastructure/scripts/extract-config.test.ts`
