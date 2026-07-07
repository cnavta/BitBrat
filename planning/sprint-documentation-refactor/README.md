# Sprint: Documentation Refactor - Platform vs Domain Bits

**Status:** Planning Complete - Ready for Execution
**Created:** 2026-07-07
**Estimated Duration:** 2 weeks (60 hours)
**Assignee:** Technical Writer

---

## Overview

This sprint comprehensively updates the BitBrat platform documentation to reflect the Platform vs Domain Bits architectural distinction and integrate the new Reflex bit's deterministic execution model into the conceptual framework.

---

## Key Deliverables

### 📚 New Documentation
- **Platform vs Domain Bits Concept Page** - Defines the architectural categories
- **Reflex Deterministic Execution Concept Page** - Explains <150ms pattern-based execution
- **Dual Execution Paths Concept Page** - Compares deterministic vs LLM-based flows
- **Reflex MCP Tools Reference** - Complete API documentation for reflex tools
- **Creating a Reflex Tutorial** - Step-by-step guide
- **Creating a Domain MCP Server Tutorial** - Domain Bit example
- **Choosing Platform vs Domain Guide** - Decision framework

### ✏️ Updated Documentation
- **README.md** - Architecture section, agent-loop table, mermaid diagram, extending section
- **architecture.yaml** - Added `category` field to all services
- **CLAUDE.md** - Updated terminology and glossary for LLMs
- **Platform Flow** - Dual execution paths integrated
- **Bit Model** - Clarified profile vs category distinction
- **Event Router & Rules** - Reflex routing documented
- **Capability Profiles** - Distinction from categories
- **Quickstart & Evaluating Guides** - Reflex mentions
- **Creating a !lurk Command Tutorial** - Reflex comparison
- **CHANGELOG.md** - Sprint documentation

---

## Project Structure

```
planning/sprint-documentation-refactor/
├── README.md                    # This file - Sprint overview
├── documentation-analysis.md    # Comprehensive gap analysis
├── execution-plan.md            # Detailed task breakdown & timeline
└── backlog.yaml                 # Trackable YAML backlog (27 tasks)
```

---

## Platform vs Domain Bits Architecture

### Platform Bits (10 Core Services)
Form the essential **perceive → plan → act → observe** agent loop:

| Bit | Role | Stage |
|-----|------|-------|
| ingress-egress | Perceive & Observe | ingest, egress |
| event-router | Plan | route |
| auth | Plan (enrich) | route |
| llm-bot | Act (LLM) | analyze |
| query-analyzer | Act (fast analysis) | analyze |
| **reflex** | Act (deterministic) | analyze |
| tool-gateway | Act (MCP fabric) | - |
| state-engine | Observe | react |
| persistence | Observe | persist |
| api-gateway | Perceive & Observe | ingest, egress |

### Domain Bits (6+ Optional Services)
Extend the platform with domain-specific capabilities:

| Bit | Purpose |
|-----|---------|
| obs-mcp | OBS Studio control |
| image-gen-mcp | DALL-E generation |
| story-engine-mcp | Collaborative storytelling |
| stream-analyst | Analytics/summarization |
| disposition-service | User behavior patterns |
| scheduler | Periodic tasks |
| oauth-flow | OAuth2 flows |

---

## Dual Execution Paths

### Deterministic Path (Reflex)
```
Perceive → Plan → Match → Execute Tool → Observe
<150ms | Low Cost | Repeated Behaviors
```

### LLM-Based Path (Traditional)
```
Perceive → Plan → Analyze → Tool Selection → Execute → Observe
2-10s | Higher Cost | Novel Situations
```

**Key Insight:** Both paths share infrastructure (ingress, router, tool-gateway, persistence) but differ in the analysis stage.

---

## Sprint Structure

### 6 Phases, 27 Tasks

**Phase 1: Foundation** (13h, 5 tasks)
- Update architecture.yaml with category field
- Create 3 new concept pages
- Update Bit Model page

**Phase 2: Core Docs** (11h, 5 tasks)
- Update README (architecture, table, diagram, extending)
- Update Platform Flow

**Phase 3: Developer Docs** (10h, 5 tasks)
- Update CLAUDE.md and brat docs
- Create choosing guide
- Update quickstart

**Phase 4: Reference Docs** (11h, 5 tasks)
- Update Capability Profiles, Event Router
- Create Reflex MCP Tools reference
- Cross-reference audit

**Phase 5: Tutorials** (11h, 3 tasks)
- Update lurk tutorial
- Create Reflex tutorial
- Create Domain MCP Server tutorial

**Phase 6: Validation** (9h, 4 tasks)
- Terminology consistency
- Diagram consistency
- Fresh eyes review
- CHANGELOG update

---

## Task Priorities

- **P0 (Blocker):** 8 tasks - Foundation and core concepts
- **P1 (High):** 12 tasks - Core deliverables
- **P2 (Medium):** 7 tasks - Important but not blocking
- **P3 (Low):** 0 tasks

---

## Dependencies

**Critical Path:**
```
DOC-001 (architecture.yaml) →
DOC-002 (Platform vs Domain) →
DOC-006 (README architecture) →
DOC-020 (Cross-reference audit) →
DOC-024 (Terminology consistency) →
DOC-026 (Fresh eyes review) →
DOC-027 (CHANGELOG)
```

**Parallel Opportunities:**
- Phase 3 can run alongside Phase 2
- Reflex and Platform concepts can be created in parallel
- All tutorials can be written concurrently

---

## Success Criteria

✓ All 27 tasks completed
✓ All active services categorized in architecture.yaml
✓ 3 new concept pages + 2 new tutorials + 1 new reference page
✓ README reflects current architecture with dual paths
✓ 100% of internal links functional
✓ Terminology consistency >95%
✓ Fresh reader can explain Platform vs Domain
✓ Fresh reader can explain dual execution paths
✓ Fresh reader can create a reflex using docs
✓ Zero architectural inaccuracies
✓ CHANGELOG updated

---

## Key Documents

1. **[documentation-analysis.md](./documentation-analysis.md)**
   - Current state assessment
   - Gap identification
   - Categorization rationale
   - Architectural insights

2. **[execution-plan.md](./execution-plan.md)**
   - Phase-by-phase breakdown
   - Detailed task descriptions
   - Acceptance criteria
   - Timeline and effort estimates
   - Risk mitigation

3. **[backlog.yaml](./backlog.yaml)**
   - Machine-readable task list
   - Dependencies mapped
   - Priorities assigned
   - Metrics tracked
   - LLM guidance included

---

## Timeline

**Estimated Completion:** 2 weeks (60 hours)

### Week 1: Foundation & Core (34 hours)
- Phase 1: Foundation (13h)
- Phase 2: Core Docs (11h)
- Phase 3: Developer Docs (10h)

### Week 2: Reference & Polish (26 hours)
- Phase 4: Reference Docs (11h)
- Phase 5: Tutorials (11h)
- Phase 6: Validation (9h)

---

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| Architecture changes during sprint | Freeze decisions at start; defer to next sprint |
| Scope creep | Strict backlog adherence; timebox tasks |
| Terminology debates | Stakeholder sign-off on Phase 1 first |
| Fresh eyes unavailable | AI assistant simulation; time-gapped self-review |

---

## Getting Started

### For Technical Writer
1. Review all three planning documents
2. Get stakeholder approval on Phase 1 definitions
3. Begin with DOC-001 (architecture.yaml)
4. Work through phases sequentially
5. Update backlog.yaml status as you complete tasks
6. Daily progress commits

### For Reviewers
1. Start with [documentation-analysis.md](./documentation-analysis.md) for context
2. Review [execution-plan.md](./execution-plan.md) for approach
3. Check [backlog.yaml](./backlog.yaml) for task details
4. Provide feedback on Phase 1 definitions before execution begins
5. Available for fresh eyes review in Phase 6?

---

## Questions or Concerns?

Contact the project maintainer or open an issue in the planning directory.

---

**Next Steps:**
1. ✅ Planning complete
2. ⏳ Stakeholder review
3. ⏳ Begin execution with DOC-001
