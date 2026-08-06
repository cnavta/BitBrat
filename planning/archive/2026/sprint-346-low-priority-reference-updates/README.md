# Sprint 346: Low-Priority Reference Updates

**Status**: 🟡 In Progress
**Sprint ID**: sprint-346
**Parent Sprint**: Sprint 345 (Documentation Update)
**Start Date**: 2026-07-18
**Role**: Technical Writer
**Branch**: `fix/low-priority-reference-updates`

---

## Quick Summary

This sprint completes the **226 deferred Firestore and GCP references** from Sprint 345, applying backend-agnostic and platform-agnostic patterns to 28 documentation files.

### Progress Overview

| Metric | Value |
|--------|-------|
| **Total Tasks** | 8 |
| **Completed** | 0 |
| **In Progress** | 0 |
| **Pending** | 8 |
| **Files to Update** | 28 |
| **Firestore Refs** | 195 |
| **GCP Refs** | 23 |
| **Estimated Duration** | 4.5 hours |
| **Time Spent** | 0 hours |

---

## Sprint Objectives

1. ✅ **Complete Medium-Priority Updates** (Phase 1)
   - Tutorial files (4 files, 20 Firestore refs)
   - Technical architecture docs (3 files, 27 Firestore refs)
   - Service documentation (3 files, 15 Firestore refs)

2. ✅ **Address Low-Priority Historical Docs** (Phase 2)
   - Architecture/design documents (10 files, ~45 refs)
   - Miscellaneous documentation (21 files, ~100+ refs)

3. ✅ **Maintain Documentation Quality** (Phase 3)
   - Consistency review
   - Cross-reference validation
   - LLM-friendliness check

---

## Files in This Directory

| File | Purpose |
|------|---------|
| `README.md` | This file - Sprint overview and quick reference |
| `execution-plan.md` | Comprehensive 12-page sprint plan with phases and tasks |
| `backlog.yaml` | Detailed task breakdown with acceptance criteria |
| `request-log.md` | Session-by-session tracking of all user requests and actions |
| `sprint-summary.md` | Final sprint summary (created at completion) |

---

## Phase Breakdown

### Phase 1: Medium-Priority Core Documentation (2.25 hours)

**Focus**: Actively used tutorials, architecture, and service docs

| Task | Files | Refs | Status |
|------|-------|------|--------|
| P1-T1: Tutorial files | 4 | 20 Firestore | 🔲 Pending |
| P1-T2: Technical architecture | 3 | 27 Firestore | 🔲 Pending |
| P1-T3: Service documentation | 3 | 15 Firestore | 🔲 Pending |

### Phase 2: Low-Priority Historical Documentation (2 hours)

**Focus**: Historical/reference docs, architecture/design docs

| Task | Files | Refs | Status |
|------|-------|------|--------|
| P2-T1: Architecture/design docs | 10 | 31 Firestore + 9 GCP | 🔲 Pending |
| P2-T2: Miscellaneous docs | 21 | 102 Firestore + 14 GCP | 🔲 Pending |

### Phase 3: Validation & Cleanup (0.5 hours)

**Focus**: Quality assurance

| Task | Description | Status |
|------|-------------|--------|
| P3-T1: Consistency review | Verify tone, patterns, no contradictions | 🔲 Pending |
| P3-T2: Cross-reference validation | Check links, file paths, sections | 🔲 Pending |
| P3-T3: LLM-friendliness check | Verify technical precision, code examples | 🔲 Pending |

---

## Update Patterns

### Pattern 1: Backend-Agnostic Terminology

```markdown
BEFORE: "stored in Firestore"
AFTER:  "stored in the database (PostgreSQL or Firestore legacy)"

BEFORE: "Firestore collection: users"
AFTER:  "Database collection/table: users"

BEFORE: "query Firestore"
AFTER:  "query the persistence backend"
```

### Pattern 2: Platform-Agnostic Messaging

```markdown
BEFORE: "Google Cloud Pub/Sub for messaging"
AFTER:  "Message bus (NATS for local/self-hosted, or cloud-specific buses like Google Cloud Pub/Sub)"

BEFORE: "deployed to Cloud Run"
AFTER:  "deployed to Docker-compatible platforms (GCP Cloud Run, AWS ECS, Azure Container Instances, self-hosted)"
```

### Pattern 3: Historical Design Docs

```markdown
ADD PREAMBLE:
> **HISTORICAL DESIGN DOCUMENT**
>
> This document describes the original [X] design using **Firestore** (legacy backend).
>
> **Current Implementation:** BitBrat now uses **PostgreSQL** as the default persistence backend.
```

---

## Success Criteria

### Sprint Completion Criteria

- ✅ All 226 deferred references updated
- ✅ Consistent documentation quality (backend/platform-agnostic)
- ✅ LLM-first principles maintained
- ✅ No regressions (previously updated files remain accurate)

### Quality Metrics

- **Consistency Score**: Target 100%
- **Accuracy Score**: Target 100%
- **Completeness Score**: Target 100%

---

## Key Documentation Standards (from CLAUDE.md)

1. **Critical Information First**: What/How/Why in first 100 words
2. **Dense, Scannable Structure**: Tables over prose, descriptive headers
3. **Technical Precision**: Exact terms, no ambiguity
4. **Cross-References**: Exact file paths and section names
5. **Platform-Agnostic Language**: Generic terms, baseline-first, mark legacy

---

## Files to Update by Category

### Category 4: Tutorial Files (P1-T1)
- `tutorials/lurk-command.md` (3 refs)
- `tutorials/lurk-command-part-2.md` (8 refs)
- `tutorials/creating-a-domain-mcp-server.md` (6 refs)
- `tutorials/creating-a-reflex.md` (3 refs)

### Category 5: Technical Architecture (P1-T2)
- `technical-architecture/user-context-v1.md` (5 refs)
- `technical-architecture/mcp-auto-discovery.md` (10 refs)
- `technical-architecture/image-gen-mcp-prompt-logging.md` (12 refs)

### Category 6: Service Documentation (P1-T3)
- `services/image-gen-mcp.md` (3 refs)
- `services/state-engine/technical-overview.md` (7 refs)
- `services/state-engine/runbook.md` (5 refs)

### Category 7: Architecture/Design Docs (P2-T1)
- `architecture/reactive-agent-loop-technical-overview.md` (1 ref)
- `architecture/acp-integration-evaluation.md` (4 Firestore + 1 GCP)
- `architecture/bit-model-technical-architecture.md` (3 refs)
- `architecture/tool-context-provisioning.md` (6 refs)
- `architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md` (3 Firestore + 5 GCP)
- `architecture/technical-architecture.md` (1 GCP)
- `bitbrat_state_memory_architecture.md` (10 refs)
- `llm_graph_mutation_architecture.md` (1 Firestore + 1 GCP)
- `sessi-implementation-gap-analysis.md` (3 refs)
- `technical-architecture/agent-centric-logging-v1.md` (1 GCP)

### Category 8: Miscellaneous Docs (P2-T2)
- Tools: `tools/brat.md` (4 refs)
- Guides: `guides/mcp-dev-tools-reference.md`, `guides/mcp-setup.md`, `guides/mcp-config-env-references.md`, `guides/brat-fleet.md`
- Reference: `reference/reflex-mcp-tools.md`, `reference/technical-architecture-base-server-resources.md`, `reference/messaging-system.md`, `reference/messaging-architecture-as-is.md`, `reference/base-server-resources-backlog.yaml`
- Observability: `observability/tracing.md` (4 GCP)
- Root: `SETUP-MCP.md`, `mcp-evolution-roadmap.md`, `routing-rules-examples.md`, `command-indexes.md`, `auth-service.md`, `llm-bot-personality.md`, `messaging-config.md`
- Evaluation: `evaluation/external-evaluation.md` (2 GCP)
- Concepts: `concepts/capability-profiles.md` (1 ref)
- Fixes: `fixes/stdio-mcp-error-recursion.md` (41 refs)

---

## Dependencies

### Depends On
- ✅ Sprint 345 completion (audit data and patterns)
- ✅ CLAUDE.md documentation standards

### Blocks
- Sprint 347: New Guide Creation
- Sprint 348: Documentation Automation

---

## Deliverables

1. **Updated Documentation Files** (28 files)
2. **Sprint Backlog** (backlog.yaml with real-time tracking)
3. **Sprint Summary** (sprint-summary.md at completion)
4. **Git Commits** (organized by phase)

---

## Quick Start

To begin working on this sprint:

1. **Read execution-plan.md** for comprehensive context
2. **Review backlog.yaml** for task details
3. **Start with Phase 1** (P1-T1: Tutorial files)
4. **Update request-log.md** after each session
5. **Commit by phase** for organized history

---

## Notes

- This sprint completes all deferred work from Sprint 345
- Focus is on consistency and completeness, not new content
- Historical design docs will retain accuracy while noting evolution
- All patterns from CLAUDE.md will be applied systematically

---

**Last Updated**: 2026-07-18 (Sprint initialization)
**Current Status**: Awaiting approval to begin Phase 1
