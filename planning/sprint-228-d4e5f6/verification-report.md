# Deliverable Verification – sprint-228-d4e5f6

## Completed
- [x] API Gateway routing updated in `architecture.yaml` (`/ws/v1`)
- [x] `brat chat` command registered in CLI
- [x] `ChatController` implemented with WebSocket support
- [x] Terminal REPL for interactive chat implemented
- [x] Heartbeat (30s) and reconnection logic added
- [x] API Gateway heartbeat acknowledgement added
- [x] Unit tests for protocol handling created
- [x] Custom WebSocket URL support via `--url` flag implemented and tested
- [x] Fixed port discrepancy for `api-gateway` (aligned to 3000)
- [x] Updated `brat chat` and TA to use local port 3001 (Docker Compose host mapping)
- [x] Corrected `egress.destination` in `api-gateway` to use instance-specific topic
- [x] Fixed response redelivery issue by strict candidate selection in `selection.ts`
- [x] Added reproduction test `tests/issue-redelivery.test.ts`
- [x] Eliminated `api-gateway` log spam by moving message bus consumption logs to new `trace` level
- [x] Extended `Logger` and `LogLevel` to support `trace`
- [x] Fixed brat chat egress payload selection to avoid user echo
- [x] Added persistence finalization to `api-gateway`
- [x] Fixed duplicate response delivery by adding missing ACKs in `api-gateway`
- [x] Mapped `egress.deliver.v1` to `chat.message.received` for standard CLI output
- [x] `validate_deliverable.sh` created and verified

## Partial
- None

## Deferred
- None

## Alignment Notes
- Added a simple heartbeat handler in `api-gateway.ts` to support the CLI's stability requirements.
- Decoupled `WebSocket` constructor in `ChatController` using a local constant to facilitate Jest mocking without affecting global scope in other tests.
