# Key Learnings – sprint-327-2c45c2

Lessons distilled for future (documentation) sprints.

1. **Document from the canonical source, not from prior docs.** The fastest path to accuracy was reading
   the registration sites and CLI help (`registerPlatformTools()` in `src/common/base-server.ts`,
   `src/common/profiles/registry.ts`, `tools/brat/src/cli/{fleet,release}.ts`) and `architecture.yaml`
   directly. This upholds AGENTS.md Law #2 (docs conform to the canonical file) and prevents propagating
   stale framing.

2. **Vocabulary migrations need a single concept anchor.** Introducing one reader-facing
   `concepts/bit-model.md` and linking everything to it made it easy to retire the "`BaseServer` vs
   `McpServer`" decision consistently across README, services, reference, guides, roadmaps, and design docs.

3. **Ship validation that runs everywhere.** For doc sprints, a dependency-free Node link checker + a
   structure check + the existing `release:dry` assertion gives a logically-passable
   `validate_deliverable.sh` even when `markdownlint` isn't installed (gracefully skipped + logged).

4. **Reconcile, don't rewrite, historical artifacts.** For design docs and roadmaps that pre-date the
   implementation, a prominent "Implemented (sprint-3xx)" status banner + targeted update notes preserves
   history while making current state unambiguous.

5. **Keep the backlog live.** Per-item status + timestamped `log` entries (todo → in_progress → done) made
   the sprint self-documenting and satisfied the owner's request to keep backlog items up to date as work
   progressed.

6. **`bit.*` is the durable platform contract.** The universal control plane (`bit.info` … `bit.shutdown`,
   `bit.llm.*`) with `bit:read` / `bit:operate` scopes and `mcp.exposure` defaults is the stable surface to
   anchor docs on; domain tools come and go, the control plane is constant.
