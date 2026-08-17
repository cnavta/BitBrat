# Key Learnings – sprint-320-1cc8aa

- **Extend an established cross-service pattern instead of inventing one.** Prompt logging already
  existed in llm-bot and query-analyzer; reusing the same flag (`llm.promptLogging.enabled`), the same
  `services/{service}/prompt_logs/{logId}` sub-collection, and the same `redactText` helper made the
  image-gen change additive — no new flag, collection family, `architecture.yaml`, or `firestore.rules`
  edit, and the backup allowlist already excludes `prompt_logs`.
- **Fire-and-forget telemetry must be contract-neutral.** An un-awaited `.add(...).catch(...)` wrapped
  in `try/catch` guarantees a logging/Firestore failure can never change or delay the tool's response;
  the most valuable test in the suite is the fail-soft case that asserts exactly this.
- **Redact at the boundary, log structured outcomes.** Applying `redactText` to every free-text field
  (`prompt`/`response`/`error`) and recording a discrete `status` (`success`/`rejected`/`error`) plus
  domain fields (aspectRatio/size/moderation/image url) keeps logs both privacy-safe and queryable.
- **MCP has no event envelope, so correlation must be explicit.** Without a pub/sub envelope there is
  no ambient `correlationId`; resolving it from `extra._meta?.correlationId` with a `uuidv4()` fallback
  is a pragmatic interim, but true cross-service correlation needs the caller to pass it through `_meta`.
- **Idempotency for registry-driven reconnects.** A watcher that calls `connectServer` on every
  Firestore snapshot must compare a signature of *connection-relevant* fields only (excluding volatile
  metadata like `updatedAt`/`correlationId`) before tearing down a healthy connection — otherwise benign
  document rewrites churn live SSE connections on a tight loop.
