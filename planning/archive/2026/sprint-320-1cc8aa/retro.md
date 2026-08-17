# Retro – sprint-320-1cc8aa (image-gen-mcp Prompt Logging)

## What worked
- **Reusing the existing pattern wholesale.** Mirroring the llm-bot/query-analyzer prompt-logging
  shape (feature-flag gate on `llm.promptLogging.enabled`, fire-and-forget
  `getFirestore()...prompt_logs.add(...)`, `redactText` on free text) meant no new feature flag, no new
  collection family, and no `architecture.yaml` or `firestore.rules` change — the design was approved
  and implemented with minimal surface area.
- **TA-first, then backlog, then code.** Authoring the Technical Architecture and decomposing it into a
  gated backlog (BL-001…BL-008) before writing code kept each call site (success / moderation-rejected /
  error) small and independently testable; the build stayed green throughout.
- **Fail-soft logging proven by test.** The dedicated 5-case suite (flag off, success, rejection, error,
  fail-soft) asserts the tool's contract is never affected by a logging failure, which is the property
  that matters most for an un-awaited write.
- **Validation harness is logically passable.** `validate_deliverable.sh` (build + the new suite + an
  llm-bot/query-analyzer regression) exits 0, so Gate G4 / DoD is demonstrable on demand.

## What didn't / friction
- The Node runtime isn't on the default non-login PATH (`node`/`npx` not found); had to export
  `/opt/homebrew/bin` in the validation script — same friction noted in sprint-319.
- MCP is request/response with no event envelope, so there is no real end-to-end `correlationId` to
  log yet; we resolve it from `extra._meta?.correlationId` and otherwise mint a `uuidv4()`. Genuine
  propagation through `_meta` is left as a documented follow-up (TA §5.4).

## Additional work folded into this branch
- A standalone remediation for the **tool-gateway SSE reconnect storm** (servers reconnecting on a
  ~10s loop) was completed on this feature branch: `McpClientManager.connectServer` is now idempotent
  via a `connectionSignature(...)` guard that skips teardown+reconnect when a healthy connection's
  connection-relevant config is unchanged (ignoring volatile registry metadata). Covered by two new
  cases in `tests/common/mcp/reconnect.spec.ts` (44/44 in `tests/common/mcp`). It is included in this
  PR for delivery; see Deferred for the residual hardening item.

## Follow-ups
- Plumb a real `correlationId` end-to-end through MCP `_meta` so image-gen logs correlate with the
  originating llm-bot/query-analyzer request (TA §5.4).
- Harden SSE liveness detection in the tool-gateway: transport drops still aren't observed
  (`transport.onclose`/`onerror`), so a dead SSE stream isn't actively detected.
