# Retro – sprint-330-91f8ad

## What worked
- **Grounding before coding paid off.** The plan's file/line evidence meant each fix was a targeted edit
  (deploy filter parity with synth; dedupe-key gap; fleet verb mirroring drain/shutdown).
- **Extracting pure helpers made the work testable** without heavy harnesses: `selectDeployableServices`
  and the shared `dedupe.ts` are unit-tested directly, and the pubsub redelivery test uses a tiny emitter.
- **Sharing one dedupe module across Pub/Sub and NATS** removed driver drift and satisfied the canonical
  `correlationId+step+attempt` invariant in one place.

## What didn't / surprises
- The Pub/Sub client **already** auto-extends leases (maxExtensionTime 1h), so lease expiry was not the
  real duplicate cause — the dedupe keyed only on correlationId (and absent on NATS) was. The message-id
  fallback is what actually closes the gap; lease config was made explicit mostly for clarity/control.
- Incomplete test mocks broke when new client options were used (`Duration.from`, `consumerOpts.ackWait`).
  Fixed by guarding the code (`Duration?.from`) and updating the NATS mock to the real API.

## Post-publication follow-ups (during close-out)
- **REQ-003:** A pre-existing supertest teardown gap (not a sprint regression) intermittently produced a
  stale-socket parse error in `repro_gateway_roles.spec.ts`; fixed with an idempotent `afterEach` close.
- **REQ-004:** Item-1's `active:false` deploy guard was only wired into the Cloud Run CLI path, so `obs-mcp`
  still shipped to docker targets. Lesson: when adding a cross-cutting policy (deploy eligibility), enumerate
  ALL entrypoints (Cloud Run synth *and* docker compose) up front rather than the first one found.

## Follow-ups
- BL-330-204 (persistent cross-instance dedupe) remains **deferred**; revisit only if a multi-replica Bit
  ever shows duplicates the per-process cache can't catch.
- Consider wiring `bit.restart` into an integration smoke test against the local docker stack in a future
  sprint (current coverage is unit-level via conformance + fleet specs).
