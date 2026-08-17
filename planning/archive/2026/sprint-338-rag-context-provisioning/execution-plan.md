# Execution Plan – P4 RAG Scale-Out for Tool Context Provisioning

- **Sprint:** sprint-338-rag-context-provisioning
- **Title:** P4 RAG Scale-Out for Tool Context Provisioning
- **Owner / Role:** Lead Implementor
- **Date:** 2026-07-11
- **Branch:** `feature/p4-rag-context-provisioning`
- **Source of truth:** `architecture.yaml` + `AGENTS.md` + `documentation/architecture/tool-context-provisioning.md`
- **Source design / issue / prompt:** `planning/sprint-338-rag-context-provisioning/technical-architecture.md` (P4 ADR extension)
- **Status:** PLANNING — awaiting owner approval; no implementation begins until approved.

---

## 1. Objective

Extend the Just-in-Time Context Provisioning system (P0-P3, sprint-328) with **retrieval-augmented generation (RAG)** to enable semantic discovery of context packs at scale. Static bindings remain the deterministic floor; RAG augments when the binding set is large or when semantic queries can discover relevant context beyond hard-coded tool-pack relationships. Packs are persisted in Firestore with vector embeddings, searchable via Firestore Vector Search, and injected just-in-time alongside statically-bound packs (de-duplicated).

**Success criteria:**
- `tool-gateway.resolveContextForTools` accepts optional `semanticQuery` parameter (backward compatible)
- `VectorContextProvider` implements `ContextProvider` interface, retrieving packs from Firestore Vector Search
- Pack embeddings generated via OpenAI `text-embedding-ada-002` on registration
- p95 latency < 200ms for embedding + vector search
- De-duplication prevents duplicate packs (static + RAG merged)
- Feature flag `RAG_CONTEXT_ENABLED` controls rollout

---

## 2. Problem Statement / Why

### Current behavior:
P0-P3 (sprint-328) established static bindings: each Bit explicitly binds context packs to tools via `registerToolWithContext(tool, [packIds])`. This works well for small ecosystems (2-10 packs) but **does not scale** when:
1. The fleet grows to 50+ domain-specific context packs across many Bits
2. Semantic relevance is more important than structural tool-pack relationships
3. New Bits register packs dynamically and hand-updating bindings is brittle

### Impact / risk:
- **Token waste:** Without RAG, we must either (a) bind every possibly-relevant pack to every tool (context bloat) or (b) under-bind and miss valuable context
- **Maintenance burden:** As the pack ecosystem grows, maintaining explicit bindings becomes unsustainable
- **Missed opportunities:** A user asks "schedule a reminder for my stream tomorrow" but the LLM doesn't get scheduler-specific context because the tool wasn't selected yet (chicken-and-egg)

### Why now:
- P0-P3 shipped a stable foundation with a **designed seam** for RAG (`ContextProvider` interface, `resolveContextPacks(providers[])` aggregation)
- The MCP Evolution Roadmap (Phase 2) already plans Firestore Vector Search for **tool discovery** — P4 reuses the same infrastructure for **context discovery**
- Current fleet is small (2 packs) but upcoming domain Bits (obs-mcp, image-gen-mcp, story-engine-mcp) will each contribute 3-5 packs, reaching the scaling threshold within 6 months

---

## 3. Grounding / Verified Baseline Facts

**Verified from P0-P3 verification report (`p0-p3-verification-report.md`):**
- ✅ `src/common/context/types.ts` defines stable `ContextProvider` interface: `listPacks()`, `listBindings()`
- ✅ `src/common/context/resolver.ts` implements `resolveContextPacks(activeSet, providers[])` with de-duplication by pack ID
- ✅ `src/apps/tool-gateway.ts:259` implements `resolveContextForTools(toolNames, extra?)` returning `NamedContext[]`
- ✅ `INTERNAL_MCP_REGISTRATION_V1` already advertises `context.{packs, bindings}` additively (backward compatible)
- ✅ Drift guard tests (`tests/common/context/context-packs-drift.spec.ts`) ensure generated packs match source of truth
- ✅ All 19/19 tests passing (11 drift guards + 8 integration tests)

**Firestore capabilities verified:**
- Firestore Vector Search supports 1536-dimension embeddings (OpenAI `text-embedding-ada-002` compatible)
- Max 2048 dimensions supported (we use 1536 ✅)
- Vector queries use cosine similarity with configurable distance measure
- Composite indexes required for filtered vector search (`active == true` + embedding)

**OpenAI embeddings verified:**
- `text-embedding-ada-002` pricing: $0.0001 / 1K tokens
- Average query: 50 tokens (tool names + short prompt snippet)
- Expected cost at 1M requests/month with 50% cache hit: $2.50/month (negligible)

**Tool-gateway integration points:**
- Current: `resolveContextForTools(toolNames, extra?)` (sync, returns `NamedContext[]`)
- P4 change: Add optional `semanticQuery?: string` parameter; make async if RAG enabled
- Callers: `llm-bot` (will pass user prompt), integration tests

---

### Conflicts or inconsistencies discovered

| Item | Source A | Source B | Resolution / Plan of Record |
|---|---|---|---|
| `resolveContextForTools` signature | Current: synchronous | P4: needs async for vector search | Make async when RAG enabled; preserve sync path when disabled (feature flag). Callers updated to `await`. |
| Pack versioning | ADR mentions versioning | P3 ships overwrites (merge: true) | P4 ships overwrites (last writer wins). Future: subcollection for version history (deferred, tracked as enhancement). |
| Embedding cache location | In-memory Map | Production needs distributed cache | P4 ships in-memory TTL-based Map (15-min). Future: Redis/Memorystore (tracked as performance optimization). |

---

## 4. Scope

### In scope

**Phase 1 - Infrastructure Setup (Week 1):**
- Create `context_packs` Firestore collection with schema (`id`, `version`, `title`, `body`, `embedding`, `embeddingText`, `bitName`, `active`, timestamps)
- Create Firestore composite index (active + bitName + id) and vector index (embedding, 1536-dim, cosine)
- Implement `VectorContextProvider` class (`src/common/context/vector-provider.ts`)
  - Embed queries via OpenAI `text-embedding-ada-002`
  - Execute Firestore Vector Search with similarity filtering
  - Implement embedding cache (in-memory, TTL-based)
- Unit tests for `VectorContextProvider` (mocked OpenAI + Firestore)
- Deploy to local environment with `RAG_CONTEXT_ENABLED=false` (infrastructure validated, no behavior change)

**Phase 2 - Pack Registration (Week 2):**
- Extend `tool-gateway.handleMcpRegistration` to upsert packs into `context_packs` Firestore collection
- Generate embeddings for each pack on registration (embed `title + body preview (500 chars)`)
- Backfill P3 generated packs (`schema.internal-event-v2`, `router.jsonlogic-guide`) into Firestore
- Manually register domain-specific packs from scheduler, event-router, obs-mcp (at least 3 packs total)
- Verify packs appear in Firestore with non-null embeddings (query console)
- Unit tests for pack registration flow

**Phase 3 - Integration (Week 3):**
- Update `tool-gateway.resolveContextForTools` signature: `async resolveContextForTools(toolNames, extra?, semanticQuery?)`
- Implement dual-path resolution:
  - Static bindings (P2) — always executed, deterministic floor
  - RAG augmentation (P4) — when `RAG_CONTEXT_ENABLED=true` AND `semanticQuery` provided
- Integrate `VectorContextProvider` into provider array when RAG enabled
- De-duplication: filter RAG results against static pack IDs
- Update llm-bot to pass `userPrompt` as `semanticQuery` (optional, backward compatible)
- Integration tests:
  - Static + RAG de-duplication (shared pack appears once)
  - RAG-only discovery (pack NOT statically bound but discovered via semantic query)
  - Feature flag disabled (P2 behavior preserved)
  - Latency compliance (p95 < 200ms)
- Deploy to staging with `RAG_CONTEXT_ENABLED=true`
- E2E validation: llm-bot request discovers RAG packs, logged in `llm_bot.prompt.context_packs`

**Phase 4 - Production Rollout (Week 4):**
- Canary rollout: Enable `RAG_CONTEXT_ENABLED=true` for 10% of llm-bot requests (A/B test via feature flag)
- Monitor metrics:
  - `context.rag.query.latency[p95]` < 200ms (SLO)
  - `context.rag.query.count[status=failure]` < 1% (error rate SLO)
  - `context.rag.cache.hit_rate` > 40% (cache effectiveness)
- Manual QA: 20 sample queries, rate relevance (target: > 80% precision)
- Full rollout: If metrics pass, enable for 100% of requests
- Rollback trigger: If p95 latency > 300ms OR error rate > 2%, disable RAG immediately
- Documentation: Update `documentation/architecture/tool-context-provisioning.md` with P4 implementation notes

### Out of scope

- **Multi-modal context (images, code snippets):** Deferred to future sprint (tracked as enhancement)
- **User feedback loop (pack utility tracking):** Deferred (requires analytics pipeline)
- **Cross-pack references (`relatedPacks`):** Deferred (risk of context bloat)
- **Per-Bit pack quotas:** Deferred (enforcement requires registry governance)
- **Distributed cache (Redis/Memorystore):** Deferred (in-memory cache sufficient for P4 scale)
- **Alternative embedding models (sentence-transformers, bge-large):** Deferred (OpenAI sufficient, low cost)
- **Pack version history (subcollections):** Deferred (overwrites acceptable for P4)

### Non-goals / explicit deferrals

- **Per-pack RBAC:** Context packs are informational (not executable like tools), so RBAC complexity deferred. Future: add `requiredRoles[]` field and filter post-retrieval if needed.
- **Content filtering for malicious packs:** Deferred to post-P4. Mitigation: audit trail (`bitName`, `source`) + manual review on launch. Future: OpenAI Moderation API on pack bodies.
- **Phase 2 tool discovery (MCP Evolution Roadmap):** P4 lays infrastructure; Phase 2 tool discovery remains a separate sprint.

---

## 5. Implementation Strategy

### 5.1 Phased Rollout (4 weeks)

**Week 1: Infrastructure Setup**
- Focus: Build and test foundation, no behavior change
- Risk mitigation: Deploy with RAG disabled; validate infrastructure in isolation
- Acceptance gate: Unit tests pass, local deploy clean, Firestore indexes created

**Week 2: Pack Registration**
- Focus: Persist packs + embeddings, backfill existing packs
- Risk mitigation: Manual verification via Firestore console; embedding generation isolated from query path
- Acceptance gate: At least 5 packs in Firestore with valid embeddings; backfill script idempotent

**Week 3: Integration**
- Focus: Wire RAG into resolution path, update callers
- Risk mitigation: Feature flag defaults to `false`; staging-only validation before prod
- Acceptance gate: Integration tests green, staging E2E passes, llm-bot logs show RAG-discovered packs

**Week 4: Production Rollout**
- Focus: Gradual production enablement with monitoring
- Risk mitigation: Canary (10%) → full rollout (100%); instant rollback via feature flag
- Acceptance gate: SLO compliance (latency/error rate), manual QA > 80% precision, no user-reported issues

### 5.2 Key Technical Decisions

**Decision 1: Sync vs Async `resolveContextForTools`**
- **Choice:** Make async when RAG enabled (feature flag); sync when disabled
- **Rationale:** Vector search requires await; backward compat preserved when RAG off
- **Impact:** Callers (llm-bot) must be updated to `await`; deploy tool-gateway first, then llm-bot

**Decision 2: Embedding Cache Location**
- **Choice:** In-memory Map with TTL (15 minutes), per tool-gateway instance
- **Rationale:** Simple, no external deps; sufficient for P4 scale (< 10 QPS); cache warming on startup covers common queries
- **Future:** Upgrade to Redis/Memorystore when QPS > 100 or multi-instance coordination needed

**Decision 3: Embedding Generation Trigger**
- **Choice:** On-demand during `handleMcpRegistration` (not background job)
- **Rationale:** Registration is already async; embedding latency (< 100ms) acceptable; ensures packs are immediately searchable
- **Fallback:** If OpenAI API fails, log warning and persist pack without embedding (searchable = false until retry)

**Decision 4: De-duplication Strategy**
- **Choice:** Static bindings win; RAG packs filtered by `staticPackIds.has(packId)`
- **Rationale:** Static bindings are deterministic and hand-verified; RAG augments but doesn't override
- **Effect:** Shared pack (e.g., `schema.internal-event-v2`) injected once even if RAG also retrieves it

**Decision 5: Feature Flag Granularity**
- **Choice:** Single boolean `RAG_CONTEXT_ENABLED` (global on/off); no per-tool flags in P4
- **Rationale:** Simplifies rollout; finer-grained control deferred to post-P4 if needed
- **Future:** Add `RAG_CONTEXT_TOOLS_ALLOWLIST` env var for selective enablement

---

## 6. Testing Strategy

### 6.1 Unit Tests

**File:** `tests/common/context/vector-provider.test.ts` (new)

**Coverage:**
1. **Embedding generation:**
   - Mock OpenAI API; verify request body (model, input text)
   - Assert embedding dimensions (1536)
   - Assert cache stores result with TTL

2. **Cache behavior:**
   - Hit: same query returns cached embedding (no API call)
   - Miss: different query calls API
   - Expiration: expired cache entry triggers re-fetch

3. **Vector query construction:**
   - Assert Firestore query uses `findNearest` with correct field, limit, distance measure (COSINE)
   - Assert filter `active == true` present

4. **Similarity filtering:**
   - Mock Firestore response with varying `_distance` values
   - Assert packs below `minSimilarity` threshold excluded
   - Assert remaining packs mapped to `ContextPack[]` (no Firestore internal fields leaked)

5. **Error handling:**
   - OpenAI API timeout → log error, return empty array (non-fatal)
   - Firestore timeout → log error, return empty array
   - Malformed embedding (wrong dimensions) → log warning, skip pack

**Mocking:**
- OpenAI client mocked via `jest.mock('openai')`
- Firestore mocked via `jest.mock('../firebase')`
- No real network calls in unit tests

### 6.2 Integration Tests

**File:** `tests/apps/context-provisioning-rag.spec.ts` (new)

**Scenarios:**

1. **Static + RAG de-duplication:**
   - Seed Firestore with `schema.internal-event-v2` (statically bound + persisted)
   - Register scheduler with static binding
   - Query with `semanticQuery="schedule a prompt"`
   - Assert pack appears once (static binding wins, RAG filtered out)

2. **RAG-only discovery:**
   - Seed Firestore with `scheduler.cron-syntax` (NOT statically bound)
   - Query with `semanticQuery="run a task every 5 minutes"`
   - Assert pack discovered via RAG (not present in static bindings)

3. **Feature flag disabled:**
   - Set `RAG_CONTEXT_ENABLED=false`
   - Query with `semanticQuery`
   - Assert only statically bound packs returned (P2 behavior)

4. **Latency compliance:**
   - Measure p95 latency of 100 `resolveContextForTools` calls with RAG enabled
   - Assert p95 < 200ms (fail test if exceeded)
   - Log breakdown (embedding time, vector search time)

5. **Empty result handling:**
   - Query with semantically irrelevant text ("asdfjkl;")
   - Assert no RAG packs returned (similarity below threshold)
   - Assert static bindings still work

**Setup:**
- Firestore emulator (local)
- Mock OpenAI API (return fixed embedding vector)
- Seed 5-10 packs with pre-computed embeddings

### 6.3 End-to-End Tests (Staging)

**Scenario:** Deploy to staging environment with `RAG_CONTEXT_ENABLED=true`

**Validation Steps:**
1. Register a new Bit (e.g., `obs-mcp`) with a domain-specific context pack (`obs.scene-switching-guide`)
2. Verify pack persisted in Firestore with non-null `embedding` field
3. Send llm-bot request via API gateway: "switch to the brb scene"
4. Inspect llm-bot logs:
   - Assert `llm_bot.prompt.context_packs` includes `obs.scene-switching-guide`
   - Assert pack was discovered via RAG (not statically bound)
5. Verify tool call succeeds (correct OBS scene switched)
6. Check Firestore Vector Search query logs (Cloud Logging filter: `context.rag.query`)

**Acceptance:**
- Pack discoverable within 30 seconds of registration
- RAG-discovered pack appears in llm-bot context
- End-to-end latency (API request → tool execution) < 2 seconds

---

## 7. Acceptance Criteria

### Phase 1 - Infrastructure Setup

- [ ] `context_packs` Firestore collection created with documented schema
- [ ] Firestore composite index (`active`, `bitName`, `id`) created and ACTIVE
- [ ] Firestore vector index (`embedding`, 1536-dim, cosine) created and ACTIVE
- [ ] `VectorContextProvider` class implemented with all methods (`listPacks`, `embedQuery`)
- [ ] Unit tests pass (embedding, cache, query construction, filtering, error handling)
- [ ] Local deploy succeeds with `RAG_CONTEXT_ENABLED=false` (no behavior change)
- [ ] `npm run build` && `npm test` green (no regressions)

### Phase 2 - Pack Registration

- [ ] `tool-gateway.handleMcpRegistration` extended to upsert packs into Firestore
- [ ] Embedding generation implemented (OpenAI API call on pack registration)
- [ ] Backfill script created and run for P3 generated packs (at least 2 packs in Firestore)
- [ ] Manual registration of 3+ domain-specific packs (scheduler, event-router, obs-mcp)
- [ ] Firestore console verification: all packs have non-null `embedding` field (1536-dim array)
- [ ] Unit tests pass for pack registration flow
- [ ] `npm run build` && `npm test` green

### Phase 3 - Integration

- [ ] `tool-gateway.resolveContextForTools` signature updated: `async (toolNames, extra?, semanticQuery?)`
- [ ] Dual-path resolution implemented (static bindings + RAG when enabled)
- [ ] De-duplication logic verified (static pack IDs filtered from RAG results)
- [ ] llm-bot updated to pass `userPrompt` as `semanticQuery` (optional parameter)
- [ ] Integration tests green (de-dup, RAG-only, feature flag, latency)
- [ ] Staging deploy succeeds with `RAG_CONTEXT_ENABLED=true`
- [ ] E2E validation: llm-bot discovers RAG pack, logged in `llm_bot.prompt.context_packs`
- [ ] `npm run build` && `npm test` green
- [ ] No regressions in P0-P3 tests (19/19 still passing)

### Phase 4 - Production Rollout

- [ ] Canary rollout: 10% of llm-bot requests with `RAG_CONTEXT_ENABLED=true`
- [ ] Metrics monitored for 24 hours:
  - [ ] `context.rag.query.latency[p95]` < 200ms (SLO met)
  - [ ] `context.rag.query.count[status=failure] / total` < 1% (error rate SLO met)
  - [ ] `context.rag.cache.hit_rate` > 40% (cache effective)
- [ ] Manual QA: 20 sample queries rated, > 80% precision (relevant packs discovered)
- [ ] No user-reported issues or performance degradation
- [ ] Full rollout: 100% of llm-bot requests with RAG enabled
- [ ] Documentation updated: `documentation/architecture/tool-context-provisioning.md` § P4 notes
- [ ] Rollback plan tested: disable `RAG_CONTEXT_ENABLED` → latency returns to baseline

---

## 8. Validation & Verification

### Build Validation
```bash
npm run build                  # TypeScript compilation clean
npm test                       # Full Jest suite green (including new tests)
npm run lint                   # ESLint clean (no new warnings)
npm run release:dry -- patch   # Version parity check (architecture.yaml / package.json / package-lock.json)
```

### Functional Validation
- P0-P3 tests still passing (19/19) — no regressions
- P4 unit tests passing (embedding, cache, query, error handling)
- P4 integration tests passing (de-dup, RAG-only, feature flag, latency)
- Staging E2E validation: RAG pack discovered and used

### Performance Validation
- p95 latency < 200ms (load test: 100 concurrent queries)
- Embedding cost projection: $2.50/month at 1M requests (within budget)
- Firestore read quota: < 1% of 10K reads/sec limit

### Security Validation
- No secrets in code (OpenAI API key from env)
- Pack source traceability (`bitName`, `source` fields populated)
- Audit trail: all pack registrations logged with `correlationId`

---

## 9. Observability & Monitoring

### Metrics (Cloud Monitoring)

| Metric | Type | Labels | Alert Threshold |
|--------|------|--------|-----------------|
| `context.rag.query.count` | Counter | `status: success\|failure` | failure rate > 1% for 5 min |
| `context.rag.query.latency` | Histogram | `cache_hit: true\|false` | p95 > 200ms for 5 min |
| `context.rag.packs.discovered` | Gauge | `query_hash` | (observability only) |
| `context.rag.cache.hit_rate` | Gauge | - | < 0.4 for 15 min (warning) |
| `context.rag.embedding.cost` | Counter | - | (cost tracking only) |

### Logs (Structured Logging)

**Key Events:**
1. `tool_gateway.context.rag_augmented` (info):
   ```json
   {
     "staticCount": 1,
     "ragCount": 2,
     "query": "schedule a prompt to remind...",
     "latencyMs": 85,
     "cacheHit": true
   }
   ```

2. `tool_gateway.context.rag_failed` (error):
   ```json
   {
     "error": "OpenAI API timeout",
     "semanticQuery": "...",
     "fallbackUsed": "static-only"
   }
   ```

3. `tool_gateway.context.pack_registered` (info):
   ```json
   {
     "packId": "scheduler.event-definition-guide",
     "bitName": "scheduler",
     "embeddingGenerated": true,
     "embeddingDimensions": 1536
   }
   ```

### Alerts

**SLO Alerts:**
1. **Latency SLO breach:** `context.rag.query.latency[p95] > 200ms` for 5 minutes → Page oncall
2. **High error rate:** `context.rag.query.count[status=failure] / total > 0.01` for 5 minutes → Slack alert
3. **Cache degradation:** `context.rag.cache.hit_rate < 0.4` for 15 minutes → Slack warning (investigate cache TTL)

**Operational Alerts:**
4. **Embedding API failures:** `openai_api.embedding.errors > 10` in 5 minutes → Slack alert
5. **Firestore quota warning:** `firestore.reads > 8000/sec` → Slack warning (approaching 10K limit)

---

## 10. Rollback Plan

### Triggers
- p95 latency > 300ms for 10 minutes
- Error rate > 2% for 5 minutes
- User-reported LLM quality degradation (> 3 reports in 24 hours)
- Firestore quota exhaustion

### Procedure
1. **Immediate:** Set `RAG_CONTEXT_ENABLED=false` via env var update (Cloud Run)
2. **Verify:** Metrics return to baseline within 5 minutes
3. **Investigate:** Review logs, identify root cause (OpenAI API, Firestore, embedding quality)
4. **Fix forward or rollback code:**
   - If config issue: adjust `RAG_CONTEXT_MAX_RESULTS`, `RAG_CONTEXT_MIN_SIMILARITY`
   - If code bug: revert tool-gateway deploy, re-test in staging
5. **Re-enable:** Only after fix validated in staging + metrics stable

### Backward Compatibility
- Disabling RAG (`RAG_CONTEXT_ENABLED=false`) reverts to P2 behavior (static bindings only)
- No schema changes to `ContextPack`, `ContextBinding`, or `ContextProvider` interfaces
- llm-bot can omit `semanticQuery` parameter; tool-gateway handles gracefully

---

## 11. Definition of Done

**Sprint complete when ALL of:**
- [ ] All acceptance criteria met (Phases 1-4)
- [ ] All tests passing (unit + integration + E2E)
- [ ] Production rollout complete (100% with RAG enabled, metrics stable)
- [ ] Documentation updated (`tool-context-provisioning.md` P4 section)
- [ ] Verification report authored (`verification-report.md`)
- [ ] Retro authored (`retro.md`)
- [ ] Key learnings authored (`key-learnings.md`)
- [ ] Code pushed to `feature/p4-rag-context-provisioning` branch
- [ ] PR created and approved (or explicit owner acceptance if auto-PR fails)
- [ ] Owner says "Sprint complete"

---

## 12. Dependencies & Risks

### External Dependencies
- **OpenAI API:** Embedding generation requires OpenAI API key + stable API availability
  - **Mitigation:** Retry logic (3 attempts, exponential backoff); cache to reduce API calls
- **Firestore Vector Search:** Requires vector index creation (one-time, manual via gcloud CLI)
  - **Mitigation:** Create index in Phase 1; verify ACTIVE before Phase 2

### Internal Dependencies
- **P0-P3 stability:** P4 builds on P0-P3 foundation; regressions would block progress
  - **Mitigation:** Continuous test suite execution; P0-P3 tests remain green
- **tool-gateway / llm-bot coordination:** Both services must be updated for full functionality
  - **Mitigation:** Deploy tool-gateway first (backward compatible); llm-bot second

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Vector search latency exceeds budget** | Medium | High | Reduce `maxResults` from 5 to 3; increase `minSimilarity` threshold; cache warming |
| **Embedding API rate limits** | Low | Medium | Monitor OpenAI API usage; implement request throttling if needed |
| **Low cache hit rate (< 40%)** | Medium | Medium | Pre-warm cache on startup; increase TTL from 15min to 30min if stable |
| **Firestore quota exhaustion** | Low | High | Monitor quota usage; scale down `maxResults` if approaching limit |
| **RAG packs not semantically relevant** | Medium | Medium | Manual QA (80% precision target); adjust `minSimilarity` threshold; curate pack bodies |
| **P0-P3 regressions** | Low | High | Run full test suite before each commit; gate merges on green tests |

### Schedule Risks
- **Week 1 (Infrastructure):** Vector index creation may take 24 hours to become ACTIVE
  - **Buffer:** Start index creation on Day 1; parallelize other work
- **Week 3 (Integration):** llm-bot changes require coordination with tool-gateway deploy
  - **Buffer:** Deploy tool-gateway first; validate in isolation before llm-bot update
- **Week 4 (Rollout):** Canary phase requires 24-hour observation before full rollout
  - **Buffer:** Schedule canary start early in week; allows time for fix-forward if issues arise

---

## 13. Open Questions & Decisions Needed

### Questions for Owner Approval

1. **Embedding model choice:**
   - **Proposed:** OpenAI `text-embedding-ada-002` (1536-dim, $0.0001/1K tokens)
   - **Alternative:** Open-source model (sentence-transformers, bge-large) hosted on Cloud Run
   - **Decision needed:** Approve OpenAI (simple, low cost) or require self-hosted?

2. **Cache TTL:**
   - **Proposed:** 15 minutes (balance freshness vs API calls)
   - **Alternative:** 30 minutes (higher hit rate) or 5 minutes (more responsive to pack updates)
   - **Decision needed:** Approve 15-min or adjust?

3. **Canary duration:**
   - **Proposed:** 24 hours at 10% before full rollout
   - **Alternative:** 48 hours (safer) or 12 hours (faster)
   - **Decision needed:** Approve 24-hour canary or adjust?

4. **P4 scope:**
   - **Proposed:** All 4 phases in this sprint
   - **Alternative:** Split Phase 4 (production rollout) into a separate sprint
   - **Decision needed:** Approve full scope or split?

### Assumptions to Validate

- ✅ Firestore Vector Search is available in our GCP project (verified: yes)
- ✅ OpenAI API key is accessible from tool-gateway (verified: secret `OPENAI_API_KEY` exists)
- ⚠️ **Vector index creation time < 24 hours** (needs validation in Phase 1)
- ⚠️ **Average embedding latency < 100ms** (needs validation in Phase 1 testing)

---

## 14. Sign-off

**Lead Implementor:** Ready for owner review and approval

**Approval required from:**
- [ ] Lead Architect (design approval)
- [ ] Product Owner (scope + priority approval)
- [ ] Quality Lead (testing strategy approval)

**Post-approval:**
Sprint begins only when owner explicitly says "Start sprint" (AGENTS.md Rule S1).

---

**Document Status:** PLANNING (awaiting approval)
**Next Steps:**
1. Owner reviews execution plan + backlog
2. Owner approves or requests changes
3. Owner says "Start sprint" to begin implementation
4. Lead Implementor tracks progress in `backlog.yaml` + `request-log.md`
