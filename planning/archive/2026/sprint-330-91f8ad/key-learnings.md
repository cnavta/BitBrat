# Key Learnings – sprint-330-91f8ad

1. **"Inactive means disabled" must be enforced at every consumer of the config, not just one.** The
   deploy bug existed because `cmdDeployServices` read `cfg.services` directly while only the IaC synth
   path filtered on `active`. Resolve canonical fields (like `active`) once in `resolveServices` so every
   caller inherits the same semantics.

2. **For at-least-once buses, the dedupe KEY is the real correctness boundary.** Lease/ack-deadline
   extension reduces redelivery but cannot eliminate it. A dedupe keyed only on `correlationId` both
   over-collapses (distinct steps) and under-protects (messages with no correlationId). Use
   `correlationId+step+attempt` with a transport message-id fallback so every redelivery is caught.

3. **Keep transport drivers behaviorally symmetric.** Pub/Sub and NATS had diverged (NATS had no dedupe).
   A single shared helper (`dedupe.ts`) prevents this class of drift and centralizes the env knobs.

4. **Make lifecycle side-effects overridable + env-guarded for testability.** `restart()` performing a
   real `process.exit(0)` is correct for production but lethal to a test runner; an overridable method +
   `BIT_RESTART_NO_EXIT` keeps it both faithful and testable.

5. **Watch for partial test mocks when introducing new client options.** Adding `Duration.from` /
   `consumerOpts.ackWait` surfaced incomplete mocks; guard library calls defensively and update mocks to
   mirror the real SDK surface.
