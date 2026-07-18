# Firestore References Audit - Sprint 345

**Date:** 2026-07-18
**Total References:** 389 across 55 files
**Audit Scope:** All `documentation/*.md` files

---

## Category 1: Already Updated (Phases 1-4)

**Status:** ✅ **COMPLETE** - No further action needed

### Entry Points (Phase 1)
- `getting-started/quickstart.md` (4 refs) - ✅ Updated to PostgreSQL-first
- `getting-started/evaluating-bitbrat.md` (1 ref) - ✅ Updated to PostgreSQL default

### Core Concepts (Phase 2)
- `concepts/platform-flow.md` (1 ref) - ✅ Updated to backend-agnostic
- `concepts/agent-flow-stages.md` (1 ref) - ✅ Updated to "database"

### Guides (Phase 3)
- `guides/seed-data.md` (12 refs) - ✅ Complete PostgreSQL-first rewrite
- `guides/backup-and-migration.md` (24 refs) - ✅ PostgreSQL sections first, Firestore marked legacy

### Firestore Documentation (Phase 4)
- `firestore/context_packs.md` (13 refs) - ✅ Deprecation notice added
- `firestore/indexes.md` (5 refs) - ✅ Deprecation notice added
- `firestore/vector-index-setup.md` (20 refs) - ✅ Deprecation notice added

### Tools (Phase 4)
- `tools/firestore-upsert.md` (10 refs) - ✅ Renamed heading, PostgreSQL examples added

### Technical Architecture (Phase 4)
- `technical-architecture/sessi-v2.md` (1 ref) - ✅ Updated to backend-agnostic
- `technical-architecture/brat-firestore-config-backup.md` (16 refs) - ✅ Deprecation notice added

**Subtotal:** 108 references across 12 files ✅

---

## Category 2: Firestore-Specific Reference Documentation

**Status:** ⚠️ **REQUIRES DEPRECATION NOTICES** - Firestore-specific guides/specs

These files document Firestore-specific features and should be marked as legacy:

### Reference Documentation (26 refs across 3 files)
1. `reference/firestore-oauth-token-storage.md` (26 refs)
   - **Title:** Firestore OAuth Token Storage
   - **Status:** Firestore-specific design doc
   - **Action:** Add deprecation notice, note PostgreSQL uses standard oauth_tokens table

2. `reference/twitch-token-storage-firestore.md` (26 refs)
   - **Title:** Twitch Token Storage in Firestore
   - **Status:** Firestore-specific implementation
   - **Action:** Add deprecation notice, cross-reference to PostgreSQL oauth_tokens

3. `reference/twitch-integration-for-llm-agents.md` (13 refs)
   - **Title:** Twitch Integration for LLM Agents
   - **Status:** Has Firestore collection references
   - **Action:** Update collection references to backend-agnostic ("database")

**Subtotal:** 65 references across 3 files (Priority: P1)

---

## Category 3: Runbooks & Operational Documentation

**Status:** ⚠️ **REQUIRES BACKEND-AGNOSTIC UPDATES**

### Runbooks (12 refs across 3 files)
1. `runbooks/brat-backup.md` (5 refs)
   - **Content:** Backup/restore procedures
   - **Action:** Update to show PostgreSQL first, Firestore as legacy option

2. `runbooks/query-analyzer.md` (2 refs)
   - **Content:** Service runbook
   - **Action:** Change "Firestore" → "database"

3. `runbooks/llm-bot-prompt-assembly.md` (2 refs)
   - **Content:** Prompt assembly runbook
   - **Action:** Change "Firestore" → "database"

### Operations (2 refs across 1 file)
4. `operations/twitch-tokens-postgresql-fix.md` (2 refs)
   - **Content:** Migration documentation
   - **Action:** Verify Firestore references are historical/context only

**Subtotal:** 14 references across 4 files (Priority: P2)

---

## Category 4: Tutorials (Deferred in Phase 3)

**Status:** ⏸️ **DEFERRED** - Already identified in P3-T6

### Tutorials (20 refs across 4 files)
1. `tutorials/lurk-command.md` (3 refs) - Deferred P3-T6
2. `tutorials/lurk-command-part-2.md` (8 refs) - Deferred P3-T6
3. `tutorials/creating-a-domain-mcp-server.md` (6 refs) - Deferred P3-T6
4. `tutorials/creating-a-reflex.md` (3 refs) - Deferred P3-T6

**Subtotal:** 20 references across 4 files (Priority: P2, already tracked in backlog)

---

## Category 5: Technical Architecture (Partially Complete)

**Status:** ⚠️ **REQUIRES BACKEND-AGNOSTIC UPDATES** - Remaining files from Phase 4

### Technical Architecture (27 refs across 3 files)
1. `technical-architecture/user-context-v1.md` (5 refs)
   - **Content:** User context design
   - **Action:** Update to backend-agnostic language

2. `technical-architecture/mcp-auto-discovery.md` (10 refs)
   - **Content:** MCP auto-discovery architecture
   - **Action:** Update to backend-agnostic language

3. `technical-architecture/image-gen-mcp-prompt-logging.md` (12 refs)
   - **Content:** Prompt logging architecture
   - **Action:** Update to backend-agnostic language

**Subtotal:** 27 references across 3 files (Priority: P2, deferred from Phase 4)

---

## Category 6: Service Documentation (Partially Complete)

**Status:** ⚠️ **REQUIRES BACKEND-AGNOSTIC UPDATES** - Remaining files from Phase 4

### Services (15 refs across 3 files)
1. `services/image-gen-mcp.md` (3 refs)
   - **Content:** Image generation service
   - **Action:** Change "Firestore" → "database"

2. `services/state-engine/technical-overview.md` (7 refs)
   - **Content:** State engine architecture
   - **Action:** Change "Firestore" → "database"

3. `services/state-engine/runbook.md` (5 refs)
   - **Content:** State engine operations
   - **Action:** Change "Firestore" → "database"

**Subtotal:** 15 references across 3 files (Priority: P2, deferred from Phase 4)

---

## Category 7: Architecture & Design Documents

**Status:** ℹ️ **LOW PRIORITY / HISTORICAL** - Design docs, may be outdated

### Architecture Documents (50+ refs across 8 files)
1. `architecture/reactive-agent-loop-technical-overview.md` (1 ref)
2. `architecture/acp-integration-evaluation.md` (4 refs)
3. `architecture/bit-model-technical-architecture.md` (3 refs)
4. `architecture/tool-context-provisioning.md` (6 refs)
5. `architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md` (3 refs)
6. `bitbrat_state_memory_architecture.md` (10 refs)
7. `llm_graph_mutation_architecture.md` (1 ref)
8. `sessi-implementation-gap-analysis.md` (3 refs)

**Action:** Review individually - may be historical design docs that don't need updates

**Subtotal:** ~31 references across 8 files (Priority: P3, review individually)

---

## Category 8: Miscellaneous Documentation

**Status:** ℹ️ **NEEDS REVIEW**

### Other Files (25+ refs across 10 files)
1. `tools/brat.md` (4 refs) - Brat CLI documentation
2. `guides/mcp-dev-tools-reference.md` (7 refs) - MCP dev tools
3. `guides/mcp-setup.md` (4 refs) - MCP setup guide
4. `guides/mcp-config-env-references.md` (8 refs) - MCP config
5. `guides/brat-fleet.md` (1 ref) - Fleet management
6. `SETUP-MCP.md` (1 ref) - MCP setup
7. `mcp-evolution-roadmap.md` (9 refs) - MCP roadmap
8. `routing-rules-examples.md` (4 refs) - Routing examples
9. `command-indexes.md` (3 refs) - Command indexes
10. `auth-service.md` (5 refs) - Auth service
11. `llm-bot-personality.md` (7 refs) - Personality docs
12. `reference/reflex-mcp-tools.md` (2 refs) - Reflex tools
13. `reference/technical-architecture-base-server-resources.md` (7 refs) - Base server
14. `reference/messaging-system.md` (1 ref) - Messaging system
15. `reference/messaging-system-improvements.md` (1 ref) - Messaging improvements
16. `reference/base-server-resources-backlog.yaml` (6 refs) - Backlog YAML
17. `fixes/stdio-mcp-error-recursion.md` (41 refs) - Bug fix documentation
18. `concepts/capability-profiles.md` (1 ref) - Capability profiles

**Subtotal:** ~100+ references across 18 files (Priority: P3, needs individual review)

---

## Summary & Recommendations

### Completed (Phase 1-4)
✅ **108 references** across 12 files - **DONE**

### High Priority (Phase 5)
🔴 **Category 2:** 65 refs across 3 files - **Firestore-specific reference docs** (P1)
🟡 **Category 3:** 14 refs across 4 files - **Runbooks** (P2)

### Medium Priority (Tracked in Backlog)
🟡 **Category 4:** 20 refs across 4 files - **Tutorials** (P2, deferred P3-T6)
🟡 **Category 5:** 27 refs across 3 files - **Technical Architecture** (P2, deferred P4-T3)
🟡 **Category 6:** 15 refs across 3 files - **Service Documentation** (P2, deferred P4-T4)

### Low Priority (Review Later)
🔵 **Category 7:** 31 refs across 8 files - **Architecture/Design Docs** (P3)
🔵 **Category 8:** 100+ refs across 18 files - **Miscellaneous** (P3)

### Total Audit Coverage
- **Completed:** 108 references (28%)
- **High Priority Remaining:** 79 references (20%)
- **Medium Priority Tracked:** 62 references (16%)
- **Low Priority:** 131+ references (36%)

### Recommended Phase 5 Actions
1. ✅ **Update Category 2** (Firestore-specific reference docs) - 3 files, ~30 min
2. ✅ **Update Category 3** (Runbooks) - 4 files, ~20 min
3. ⏸️ **Defer Categories 5-6** (already tracked in backlog for future sprints)
4. ⏸️ **Defer Categories 7-8** (historical docs, low impact)

**Estimated Time for Phase 5 P5-T1:** 50 minutes (Categories 2-3 only)
