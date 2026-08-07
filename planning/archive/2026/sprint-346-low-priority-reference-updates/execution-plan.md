# Sprint 346: Low-Priority Reference Updates - Execution Plan

**Sprint ID**: sprint-346
**Sprint Name**: Low-Priority Reference Updates
**Start Date**: 2026-07-18
**Role**: Technical Writer
**Estimated Duration**: 3-4 hours
**Parent Sprint**: Sprint 345 (Documentation Update)

---

## Overview

This sprint completes the **deferred low-priority reference updates** from Sprint 345. We will systematically update 226 remaining Firestore and GCP references across 28 documentation files, transforming them to use backend-agnostic language and platform-agnostic messaging.

### Sprint Objectives

1. **Complete Medium-Priority Updates** (Categories 4-6 from Sprint 345 audit)
   - Tutorial files (20 Firestore refs across 4 files)
   - Technical architecture docs (27 Firestore refs across 3 files)
   - Service documentation (15 Firestore refs across 3 files)

2. **Address Low-Priority Historical Docs** (Categories 7-8 from Sprint 345 audit)
   - Architecture/design documents (31 Firestore refs across 8 files)
   - Miscellaneous documentation (100+ Firestore refs across 18 files)
   - GCP reference docs (26 refs across various files)

3. **Maintain Documentation Quality**
   - Apply LLM-first principles established in Sprint 345
   - Use consistent patterns (PostgreSQL=default, Firestore=legacy)
   - Preserve technical accuracy for historical context

---

## Scope Definition

### In Scope

✅ **All deferred Firestore references** from Sprint 345 audit (Categories 4-8)
✅ **All deferred GCP references** from Sprint 345 audit (Categories 5-7)
✅ **Backend-agnostic language updates** ("database" instead of "Firestore")
✅ **Platform-agnostic messaging** (multi-cloud examples, NATS default)
✅ **Deprecation notices** for Firestore-specific content (where appropriate)
✅ **Historical context preservation** (design docs remain accurate for their time period)

### Out of Scope

❌ **Code changes** - Documentation only
❌ **New guide creation** - postgres-setup.md, docker-production-deployment.md (deferred to Sprint 347)
❌ **Documentation verification script** - Automation deferred to Sprint 348
❌ **Already updated files** from Sprint 345 (108 refs across 12 files)

---

## Documentation Philosophy

This sprint continues the **LLM-first documentation philosophy** established in Sprint 345:

### Core Principles

1. **Technical Precision**: Use exact terms, backend-agnostic language
2. **Platform-Agnostic**: Docker + PostgreSQL + NATS baseline, cloud platforms as examples
3. **Consistent Patterns**: PostgreSQL=default, Firestore=legacy, GCP=optional
4. **Historical Context**: Preserve accuracy for design docs while noting current state

### Update Patterns

**Pattern 1: Backend-Agnostic Terminology**
```markdown
BEFORE: "stored in Firestore"
AFTER:  "stored in the database (PostgreSQL or Firestore legacy)"

BEFORE: "Firestore collection: users"
AFTER:  "Database collection/table: users"

BEFORE: "query Firestore"
AFTER:  "query the persistence backend"
```

**Pattern 2: Platform-Agnostic Messaging**
```markdown
BEFORE: "Google Cloud Pub/Sub for messaging"
AFTER:  "Message bus (NATS for local/self-hosted, or cloud-specific buses like Google Cloud Pub/Sub for managed deployments)"

BEFORE: "deployed to Cloud Run"
AFTER:  "deployed to Docker-compatible platforms (GCP Cloud Run, AWS ECS, Azure Container Instances, self-hosted)"
```

**Pattern 3: Historical Design Docs**
```markdown
FOR: Design docs describing past Firestore-specific implementations

ADD PREAMBLE:
> **HISTORICAL DESIGN DOCUMENT**
>
> This document describes the original [X] design using **Firestore** (legacy backend).
>
> **Current Implementation:** BitBrat now uses **PostgreSQL** as the default persistence backend. Core concepts remain valid, but storage implementation has evolved. See [Current Architecture](../path/to/current.md).
```

---

## Task Breakdown by Category

### Category 4: Tutorial Files (Priority: P2)

**Firestore References**: 20 across 4 files
**Estimated Time**: 60 minutes

**Files**:
1. `tutorials/lurk-command.md` (3 refs)
2. `tutorials/lurk-command-part-2.md` (8 refs)
3. `tutorials/creating-a-domain-mcp-server.md` (6 refs)
4. `tutorials/creating-a-reflex.md` (3 refs)

**Update Strategy**:
- Change Firestore API examples to DocumentStore API (backend-agnostic)
- Update code snippets to show PostgreSQL or generic patterns
- Preserve tutorial flow and learning objectives
- Add notes where Firestore-specific features are shown

### Category 5: Technical Architecture (Priority: P2)

**Firestore References**: 27 across 3 files
**Estimated Time**: 45 minutes

**Files**:
1. `technical-architecture/user-context-v1.md` (5 refs)
2. `technical-architecture/mcp-auto-discovery.md` (10 refs)
3. `technical-architecture/image-gen-mcp-prompt-logging.md` (12 refs)

**Update Strategy**:
- Update to backend-agnostic language throughout
- Preserve architectural concepts (remain valid regardless of backend)
- Update diagrams if they show Firestore-specific storage
- Add notes clarifying current vs historical implementation

### Category 6: Service Documentation (Priority: P2)

**Firestore References**: 15 across 3 files
**Estimated Time**: 30 minutes

**Files**:
1. `services/image-gen-mcp.md` (3 refs)
2. `services/state-engine/technical-overview.md` (7 refs)
3. `services/state-engine/runbook.md` (5 refs)

**Update Strategy**:
- Change "Firestore" → "database" throughout
- Update storage paths: "collection or table depending on backend"
- Preserve operational procedures (remain valid for both backends)

### Category 7: Architecture & Design Documents (Priority: P3)

**Firestore References**: 31 across 8 files
**GCP References**: ~14 across 7 files (overlap)
**Estimated Time**: 60 minutes

**Files**:
1. `architecture/reactive-agent-loop-technical-overview.md` (1 Firestore ref)
2. `architecture/acp-integration-evaluation.md` (4 Firestore refs, 1 GCP ref)
3. `architecture/bit-model-technical-architecture.md` (3 Firestore refs)
4. `architecture/tool-context-provisioning.md` (6 Firestore refs)
5. `architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md` (3 Firestore refs, 5 GCP refs)
6. `architecture/technical-architecture.md` (0 Firestore refs, 1 GCP ref)
7. `bitbrat_state_memory_architecture.md` (10 Firestore refs)
8. `llm_graph_mutation_architecture.md` (1 Firestore ref, 1 GCP ref)
9. `sessi-implementation-gap-analysis.md` (3 Firestore refs)
10. `technical-architecture/agent-centric-logging-v1.md` (0 Firestore refs, 1 GCP ref)

**Update Strategy**:
- Add "HISTORICAL DESIGN DOCUMENT" preambles where appropriate
- Update to backend-agnostic language while preserving design intent
- Note evolution from Firestore → PostgreSQL where relevant
- Preserve architectural concepts (often backend-agnostic)

### Category 8: Miscellaneous Documentation (Priority: P3)

**Firestore References**: 100+ across 18 files
**GCP References**: ~12 across 8 files (overlap)
**Estimated Time**: 90 minutes

**Files** (organized by subdirectory):

**Tools**:
1. `tools/brat.md` (4 Firestore refs) - Brat CLI documentation

**Guides**:
2. `guides/mcp-dev-tools-reference.md` (7 Firestore refs, 2 GCP refs) - MCP dev tools
3. `guides/mcp-setup.md` (4 Firestore refs) - MCP setup guide
4. `guides/mcp-config-env-references.md` (8 Firestore refs) - MCP config
5. `guides/brat-fleet.md` (1 Firestore ref) - Fleet management

**Reference**:
6. `reference/reflex-mcp-tools.md` (2 Firestore refs) - Reflex tools
7. `reference/technical-architecture-base-server-resources.md` (7 Firestore refs) - Base server
8. `reference/messaging-system.md` (1 Firestore ref, 3 GCP refs) - Messaging system
9. `reference/messaging-architecture-as-is.md` (0 Firestore refs, 2 GCP refs) - Current state
10. `reference/messaging-system-improvements.md` (0 Firestore refs, 0 GCP refs) - Future improvements
11. `reference/base-server-resources-backlog.yaml` (6 Firestore refs) - Backlog YAML

**Observability**:
12. `observability/tracing.md` (0 Firestore refs, 4 GCP refs) - Tracing infrastructure

**Root Documentation**:
13. `SETUP-MCP.md` (1 Firestore ref) - MCP setup
14. `mcp-evolution-roadmap.md` (9 Firestore refs) - MCP roadmap
15. `routing-rules-examples.md` (4 Firestore refs) - Routing examples
16. `command-indexes.md` (3 Firestore refs) - Command indexes
17. `auth-service.md` (5 Firestore refs) - Auth service
18. `llm-bot-personality.md` (7 Firestore refs) - Personality docs
19. `messaging-config.md` (1 Firestore ref, 1 GCP ref) - Message bus configuration

**Services** (additional):
20. `services/image-gen-mcp.md` (0 Firestore refs, 1 GCP ref) - Already covered in Category 6
21. `services/state-engine/runbook.md` (0 Firestore refs, 1 GCP ref) - Already covered in Category 6

**Evaluation**:
22. `evaluation/external-evaluation.md` (0 Firestore refs, 2 GCP refs) - Evaluation framework

**Concepts**:
23. `concepts/capability-profiles.md` (1 Firestore ref) - Capability profiles

**Fixes** (Bug Documentation):
24. `fixes/stdio-mcp-error-recursion.md` (41 Firestore refs) - Bug fix documentation

**Update Strategy**:
- Prioritize active guides (mcp-*, brat-fleet) over historical docs
- Update messaging docs to show NATS as default, cloud buses as options
- Preserve bug fix documentation accuracy (historical context)
- Add notes to roadmap docs clarifying current state vs future plans

---

## Phased Execution Plan

### Phase 1: Medium-Priority Core Documentation (2 hours)

**Focus**: Categories 4-6 (actively used docs)

**Tasks**:
1. P1-T1: Update tutorial files (4 files, 20 refs) - 60 min
2. P1-T2: Update technical architecture docs (3 files, 27 refs) - 45 min
3. P1-T3: Update service documentation (3 files, 15 refs) - 30 min

**Acceptance Criteria**:
- All tutorial code examples use backend-agnostic patterns
- Technical architecture docs use "database" terminology
- Service docs accurately describe PostgreSQL and Firestore legacy support

### Phase 2: Low-Priority Historical Documentation (2 hours)

**Focus**: Categories 7-8 (historical/reference docs)

**Tasks**:
1. P2-T1: Update architecture/design docs (10 files, ~45 refs) - 60 min
2. P2-T2: Update miscellaneous documentation (24 files, ~100+ refs) - 90 min

**Acceptance Criteria**:
- Historical design docs have appropriate preambles
- All Firestore refs updated to backend-agnostic language
- All GCP refs updated to platform-agnostic messaging
- Bug fix documentation preserves historical accuracy

### Phase 3: Validation & Cleanup (30 minutes)

**Tasks**:
1. P3-T1: Consistency review across all updated files - 15 min
2. P3-T2: Verify cross-references and links - 10 min
3. P3-T3: Final LLM-friendliness check - 5 min

**Acceptance Criteria**:
- Consistent tone (PostgreSQL=default, Firestore=legacy, GCP=optional)
- No broken cross-references
- No contradictory statements between files
- All code examples syntactically correct

---

## Success Criteria

### Sprint Completion Criteria

1. ✅ **All 226 deferred references updated**
   - 202 Firestore refs across 29 files
   - 26 GCP refs across 10 files (some overlap)

2. ✅ **Consistent documentation quality**
   - Backend-agnostic language throughout
   - Platform-agnostic messaging for deployment/messaging
   - Historical context preserved where appropriate

3. ✅ **LLM-first principles maintained**
   - Technical precision in all updates
   - Consistent patterns across files
   - Cross-references valid

4. ✅ **No regressions**
   - Previously updated files remain accurate
   - No broken links introduced
   - Code examples syntactically correct

### Quality Metrics

- **Consistency Score**: 100% (all refs follow established patterns)
- **Accuracy Score**: 100% (no technical errors introduced)
- **Completeness Score**: 100% (all deferred refs addressed)

---

## Risk Assessment

### Low Risks

1. **Large file count** (28 files to update)
   - Mitigation: Phased approach, systematic updates

2. **Historical accuracy** (design docs describe past implementations)
   - Mitigation: Add preambles, preserve original intent

3. **Cross-reference validity** (updates may affect links)
   - Mitigation: Dedicated validation task (P3-T2)

### No Blocking Risks Identified

This is a documentation-only sprint with well-defined patterns from Sprint 345.

---

## Dependencies

### Depends On

- ✅ Sprint 345 completion (provides audit data and patterns)
- ✅ LLM-first documentation standards (established in CLAUDE.md)

### Blocks

- Sprint 347: New Guide Creation (postgres-setup.md, docker-production-deployment.md)
- Sprint 348: Documentation Automation (verification script)

---

## Deliverables

1. **Updated Documentation Files** (28 files)
   - All Firestore refs → backend-agnostic
   - All GCP refs → platform-agnostic
   - Historical preambles added where appropriate

2. **Sprint Backlog** (backlog.yaml)
   - Detailed task breakdown with estimates
   - Real-time status tracking

3. **Sprint Summary** (sprint-summary.md)
   - Completion metrics
   - Updated file list
   - Lessons learned

4. **Git Commits**
   - Feature branch: `fix/low-priority-reference-updates`
   - Organized by phase (Phase 1, Phase 2, Phase 3)
   - Ready for Pull Request to `main`

---

## Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: Medium-Priority Core | 2 hours | 2 hours |
| Phase 2: Low-Priority Historical | 2 hours | 4 hours |
| Phase 3: Validation & Cleanup | 30 min | 4.5 hours |
| **Total** | **4.5 hours** | |

---

## Approval & Sign-Off

**Plan Approved By**: [Awaiting user confirmation]
**Start Date**: 2026-07-18
**Target Completion**: 2026-07-18

---

## Notes

- This sprint completes all deferred work from Sprint 345
- Focus is on consistency and completeness, not new content
- Historical design docs will retain accuracy while noting evolution
- All patterns established in Sprint 345 will be applied systematically
