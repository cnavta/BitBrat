# Key Learnings – sprint-325-d7f389 (BL-204 — Brat as a Fleet MCP Client)

1. **Address at the seam you already route on.** The gateway routes tools by their registry id, so the
   entire per-Bit addressing feature reduced to qualifying the id at one place (`McpBridge.translateTool`)
   for `bit.*` tools only. Find the single key the rest of the system keys on before adding new plumbing.

2. **Qualify the minimum.** Only platform (`bit.*`) tools collide across Bits; domain tools already carry
   distinct names. Restricting the qualification to `bit.*` kept the change additive and regression-free
   (no domain-tool/RBAC test moved).

3. **Inject the externals, test the logic.** Threading `clientFactory`/`fetchImpl`/`registryFactory`/
   `resolveIdentityFn` through the transports, client, and command let every behavior — fail-closed auth,
   `--all` partial failure, `--confirm` gating, `--direct` audit + `--all` rejection — be asserted with
   pure unit tests and no live gateway/Firestore.

4. **Keep RBAC server-authoritative on the client side too.** Brat forwards roles via `_meta` and a role
   *hint* per command class, but never decides allow/deny and never retries a `Forbidden`. This keeps the
   security model honest and the client thin.

5. **Parity is a property of what you DON'T assume.** Because discovery uses each Bit's registry-published
   URL and the bus backend is off the synchronous MCP call path, parity across GCP/Local/Remote Docker is
   proven by asserting identical behavior under both `MESSAGE_BUS_DRIVER` values and that the transport
   connects to exactly the registry URL — not by special-casing any target.

6. **Mind the transport's id constraints.** A Bit-qualified id contains `/`, which an Express `:id` route
   won't match raw — the client must URL-encode it for the REST mirror. Encode early; assert it in a test.
