# Request Log – sprint-324-00782d (The Bit Model & Universal MCP Control Plane)

## REQ-001 — 2026-06-26T13:30:00Z — "Planning approved. Start sprint."
- **Prompt summary:** Owner approved the Bit-model plan and instructed to start the sprint.
- **Interpretation:** Begin the LLM Sprint Protocol for the accepted Bit-model architecture
  (`documentation/architecture/bit-model-technical-architecture.md`) using the approved
  `planning/bit-model/execution-plan.md` + `planning/bit-model/backlog.yaml`.
- **Process note (Rule S3):** Detected `sprint-323-49faff` still in `verifying` status; asked the owner.
  Owner replied "Sprint complete for 323" → marked sprint-323 manifest `complete` (PR-failure accepted
  per Rule S13).
- **Commands executed:**
  - `git checkout -b feature/sprint-324-00782d-bit-model-universal-mcp`
  - `mkdir -p planning/sprint-324-00782d`
- **Files created/modified:**
  - `planning/sprint-323-49faff/sprint-manifest.yaml` (status → complete)
  - `planning/sprint-324-00782d/sprint-manifest.yaml` (new)
  - `planning/sprint-324-00782d/request-log.md` (this file)
  - `planning/sprint-324-00782d/implementation-plan.md`
  - `planning/sprint-324-00782d/backlog.yaml` (working tracker, copied from approved backlog)

## REQ-002 — 2026-06-26T14:22:00Z — "Please continue to Phase 2."
- **Prompt summary:** Owner instructed to continue the active Bit-model sprint into Phase 2 (LLM profile
  / composition).
- **Interpretation:** Implement BL-300…304: the composition mechanism (`applyProfiles` + profile→mixin
  enforcement), the Eventing/Resources/McpClient/Llm profiles, the `bit.llm.*` admin tools, and refit the
  three LLM Bits (`llm-bot`, `query-analyzer`, `stream-analyst`) — additively and behavior-preserving.
- **Files created:**
  - `src/common/profiles/{types,registry,eventing-profile,resources-profile,mcp-client-profile,llm-profile,index}.ts`
  - `tests/common/bit-profiles.spec.ts` (14 tests: composition, contract enforcement, profiles, `bit.llm.*`)
- **Files modified:**
  - `src/common/base-server.ts` (added `onStartup`/`onShutdown` lifecycle hooks; `resolveProfile()` +
    `bootstrapProfiles()` invoked after `initializeMcp`)
  - `src/apps/llm-bot-service.ts` (refit onto Bit + EventingProfile/LlmProfile/McpClientProfile; removed
    hand-rolled McpClientManager/RegistryWatcher + close override)
  - `src/apps/query-analyzer.ts` (extends Bit + EventingProfile/LlmProfile)
  - `src/apps/stream-analyst-service.ts` (applyProfiles EventingProfile/LlmProfile over its McpServer base)
  - `planning/sprint-324-00782d/backlog.yaml` (BL-300…304 → done), `verification-report.md`, `CHANGELOG.md`
- **Commands executed:** `npm run build` (green), `npm test` (267 suites / 949 tests passing, 0 failing),
  `bash ./validate_deliverable.sh` (exit 0, incl. PubSub/NATS parity).
- **Result:** Gate G2 met (composition + LlmProfile + three refits; duplication removed; behavior
  preserved). Phase 3 (BL-400/401) and BL-204 remain deferred.

---

## 2026-06-26 — Phase 3 (deprecate & retire): BL-400 + BL-401 (Gate G3)
- **Prompt:** "Please continue to Phase 3"
- **Interpretation:** Execute the approved Phase 3 of the active sprint: make `McpServer` a thin compat
  shim, remove `extends McpServer`/`extends BaseServer` from all production code (services declare
  profile/exposure instead), update `brat service bootstrap` templates + developer docs to the Bit
  vocabulary (BL-400), then retire the deprecated `BaseServer` alias and update `CHANGELOG.md` (BL-401).
  BL-204 (Brat fleet MCP client) is a separately-deferred Phase 1 item and is out of Phase 3 scope.
- **Files modified (production):**
  - Services → `extends Bit`: `src/apps/{tool-gateway,obs-mcp,story-engine-mcp,state-engine,
    event-router-service,api-gateway,auth-service,scheduler-service,stream-analyst-service}.ts`,
    `src/services/image-gen-mcp/index.ts` (the 10 former `extends McpServer`, now passing explicit
    `mcpExposure: 'platform+domain'`); `src/apps/{ingress-egress-service,disposition-service,
    persistence-service,oauth-service}.ts` (the 4 former `extends BaseServer`).
  - `src/common/mcp-server.ts` (shim now `extends Bit`); `src/common/mcp/{client-manager,registry-watcher}.ts`
    (`BaseServer` type → `Bit`); `src/services/oauth/providers/{discord,twitch}-adapter.ts`,
    `src/services/twitch-oauth.ts`, `src/services/llm-bot/{processor,instance-memory}.ts` (refs → `Bit`).
  - `src/common/base-server.ts` (deleted the `export class BaseServer extends Bit` alias; internal static
    self-refs `BaseServer.*` → `Bit.*`).
  - `tools/brat/src/cli/bootstrap.ts` (generated services now `extends Bit`, + `mcpExposure` when MCP).
- **Files modified (tests / docs):** ~40 spec/test files migrated `BaseServer`→`Bit` (imports, `extends`,
  `jest.spyOn(BaseServer.prototype,…)`→`Bit.prototype`, `as BaseServer` casts, and the `base-server` jest
  module-mock keys in `tests/unit/apps/state-engine.test.ts` + `src/apps/__tests__/account-type-egress.test.ts`);
  `documentation/services/{mcp-server,base-server-routing}.md`; `CHANGELOG.md`;
  `planning/sprint-324-00782d/{backlog.yaml,verification-report.md,retro.md}`.
- **Commands executed:** `npm run build` (green), `npm test` (267 suites / 949 tests passing, 0 failing),
  `bash ./validate_deliverable.sh` (exit 0, incl. PubSub/NATS GCP/Local/Remote-Docker parity), backlog YAML
  parse-check (18 done / 1 deferred-todo / 1 in_progress, no dangling deps).
- **Result:** Gate G3 met — no production code references `extends McpServer`; the `BaseServer` alias is
  removed; CHANGELOG + bootstrap templates + docs speak "Bit". Behavior-preserving (test count unchanged).

---

## Request — Sprint close-out (2026-06-26)
- **Prompt:** "Sprint complete."
- **Interpretation:** Formal completion trigger (Rule S2) for the active sprint-324-00782d, which was in
  `verifying` (all in-scope work done, build/suite/validate green, branch pushed; only the PR was missing
  because no `gh` CLI / GitHub token is available). This also constitutes explicit owner acceptance of
  PR-less closure under Rule S13.
- **Actions taken:**
  - `sprint-manifest.yaml`: `status: verifying` → `status: complete` (cites owner "Sprint complete." +
    Rule S13 acceptance; BL-204 carried forward to next sprint — its design doc already shipped).
  - `publication.yaml`: `status: failed` → `closed-without-pr`; added `owner_closure_acceptance`
    (accepted, trigger "Sprint complete.", Rule S13) and updated notes.
  - This `request-log.md` entry.
- **Close-out condition check:** validate_deliverable.sh logically passable ✓; verification-report.md ✓;
  retro.md ✓; key-learnings.md ✓; PR-less closure explicitly accepted by owner ✓ (Rule S13).
- **Result:** Sprint sprint-324-00782d is **complete**. No code changed during close-out (planning
  artifacts only). Carry-forward: BL-204 (Brat fleet MCP client) — architecture doc shipped, slated for
  the next sprint.
