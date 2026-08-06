# Sprint 345: Documentation Update - Execution Plan

**Sprint Goal:** Update BitBrat documentation to reflect PostgreSQL as default persistence and Docker-first deployment approach, while maintaining GCP as a supported production platform.

**Role:** Technical Writer
**Duration Estimate:** 12-16 hours
**Priority:** High (user-facing documentation correctness)

---

## Executive Summary

BitBrat's documentation currently presents Firestore and GCP as the primary/only options, which conflicts with recent architectural changes (Sprint 344) that established PostgreSQL as the default persistence layer. This sprint will systematically update all documentation to:

1. **Primary Goal**: Position PostgreSQL as the default/recommended persistence backend
2. **Secondary Goal**: Reframe deployment documentation with Docker as the standard, GCP as a supported production option
3. **Tertiary Goal**: Maintain accuracy for users still on Firestore or preferring GCP deployments

---

## Problem Analysis

### Current Documentation State

**Critical Issues (Blocks New Users):**
1. README.md explicitly states "The only persistence framework supported is Firestore" (line 8)
2. Prerequisites section requires GCP SDK and Project ID before trying platform
3. Setup flow (`brat setup`) documentation emphasizes GCP configuration first
4. Capabilities matrix states Firestore as only option (line 242)

**High-Priority Issues (Misleading):**
5. Memory/persistence architecture descriptions reference Firestore exclusively
6. Quickstart guide may emphasize Firestore emulator over PostgreSQL
7. Deployment guides likely GCP-centric without Docker production context

**Medium-Priority Issues (Incomplete):**
8. Missing PostgreSQL-specific guides (migrations, schema management, backup)
9. Firestore-specific documentation not marked as legacy/alternative
10. Architecture diagrams show "Firestore" without noting PostgreSQL option

**Low-Priority Issues (Cleanup):**
11. Code examples and snippets may reference Firestore APIs
12. Troubleshooting sections may lack PostgreSQL-specific guidance

### Root Causes

1. **Historical Context**: Platform originally designed with Firestore as only option (pre-Sprint 344)
2. **Rapid Evolution**: PostgreSQL support added quickly, documentation lagged implementation
3. **GCP Coupling**: Early design decision to simplify scope with single cloud provider
4. **Documentation Debt**: 89 markdown files, many interconnected, no systematic audit post-migration

---

## Strategy & Approach

### Documentation Philosophy: LLM-First, Human-Friendly

**Primary Audience: LLM Evaluators**

Documentation must prioritize **information density and discoverability for LLM evaluators** while remaining human-readable. This means:

1. **Critical information first**: What is this? What does it do? How does it work?
2. **Dense, scannable structure**: Clear headers, concise paragraphs, tables over prose
3. **Technical precision**: Exact terms, no marketing fluff, architecture before tutorials
4. **Explicit relationships**: Clear links between concepts, components, and dependencies
5. **Code-adjacent documentation**: Architecture diagrams near code references

**LLM-Optimized Structure Pattern:**
```
1. [Concise Definition] - What is this? (1-2 sentences)
2. [Core Concepts Table] - Key abstractions with definitions
3. [Architecture Diagram] - Visual system overview
4. [Quick Reference] - Common operations, CLI commands
5. [Detailed Sections] - Deep dives with clear headers
```

**Anti-Patterns to Avoid:**
- ❌ Long narrative introductions before substance
- ❌ Marketing language over technical precision
- ❌ Buried key information after 5+ paragraphs
- ❌ Ambiguous pronouns ("it", "this", "that" without clear antecedent)
- ❌ Hidden dependencies (prereqs mentioned late in document)

**Success Criteria for LLM-Friendliness:**
- LLM can extract "What is BitBrat?" in first 100 words
- LLM can identify core components from README alone
- LLM can find deployment instructions without scrolling
- LLM can understand architecture without reading tutorials
- Tables, diagrams, and structured data over prose paragraphs

### Documentation Positioning Strategy

**Core Vision:**
BitBrat is designed to be **deployment-platform agnostic**. By focusing on Docker as the primary deployment model, we ensure the platform can run anywhere—cloud providers, self-hosted infrastructure, or local development—without vendor lock-in. Docker provides the baseline; specific platforms (GCP Cloud Run, AWS, Azure, etc.) are implementation choices, not requirements.

**New Hierarchy (Sprint 345 Target):**

```
Primary Path (Platform-Agnostic):
  Persistence: PostgreSQL (any managed or self-hosted PostgreSQL)
  Deployment: Docker (runs anywhere: local, cloud, self-hosted)
  Message Bus: NATS (local) → configurable (production: NATS, Pub/Sub, etc.)

Supported Platform-Specific Alternatives:
  Persistence: Firestore (legacy, GCP-specific, deprecated, migration path documented)
  Deployment: Google Cloud Run (validated production option, one of many)
  Message Bus: Google Cloud Pub/Sub (GCP-specific option)
```

**Tone & Messaging:**
- **PostgreSQL**: "Default", "Platform-agnostic", "Works with any PostgreSQL service"
- **Firestore**: "Legacy", "GCP-specific", "Deprecated", "Migration available"
- **Docker**: "Platform-agnostic deployment", "Runs anywhere", "Baseline standard"
- **GCP**: "One validated production platform", "Reference implementation", "Not required"
- **Platform Agnostic**: "Core design principle", "No vendor lock-in", "Run anywhere"

**Key Messaging Shift:**
- **OLD**: "Docker for local, GCP for production"
- **NEW**: "Docker everywhere (local, cloud, self-hosted). GCP is one proven production option, but BitBrat runs on any platform that supports Docker and PostgreSQL."

### Phased Implementation

#### Phase 1: Critical Path (README.md + Entry Points)
**Goal:** Fix first-impression documentation that blocks/misleads new users

- README.md: Update warning box, capabilities matrix, prerequisites, setup flow
- quickstart.md: Reorder sections (PostgreSQL first, Firestore optional)
- evaluating-bitbrat.md: Ensure 5-minute eval uses PostgreSQL
- CLAUDE.md: Minor tweaks (already mostly updated in Sprint 344)

**Success Criteria:**
- New user can start platform with zero GCP/Firestore knowledge
- Prerequisites are minimal (Node, npm, Docker)
- GCP mentioned as optional production deployment target

#### Phase 2: Core Conceptual Documentation
**Goal:** Update architectural descriptions and flow diagrams

- bit-model.md: Update persistence layer references
- platform-flow.md: Update lifecycle diagrams (Firestore → PostgreSQL)
- Architecture README diagrams: Add PostgreSQL option

**Success Criteria:**
- Architecture diagrams show PostgreSQL as default
- Firestore clearly marked as alternative

#### Phase 3: Guides & Tutorials
**Goal:** Ensure hands-on docs use PostgreSQL by default

- seed-data.md: PostgreSQL seeding instructions primary
- backup-and-migration.md: Add PostgreSQL backup section
- Create new guide: `postgres-setup.md` (schema, migrations, local dev)
- Create new guide: `docker-production-deployment.md`
- Update existing GCP guides: Frame as "production option" not default

**Success Criteria:**
- All tutorials use PostgreSQL examples
- GCP guides remain accurate but repositioned

#### Phase 4: Reference & Technical Architecture
**Goal:** Update low-level technical documentation

- Audit `documentation/firestore/` - add deprecation notices
- Audit `documentation/technical-architecture/` - PostgreSQL updates
- Update `documentation/services/` - persistence backend references
- Update tool documentation (brat CLI, firestore-upsert)

**Success Criteria:**
- Firestore docs clearly marked as legacy
- Technical specs accurate for current architecture

#### Phase 5: Cleanup & Validation
**Goal:** Ensure consistency and completeness

- Search all `.md` files for "Firestore" and "GCP" - audit each reference
- Update code examples embedded in docs
- Create migration guide: `documentation/guides/firestore-to-postgres-migration.md`
- Final consistency pass

**Success Criteria:**
- No contradictory statements across documentation
- Migration path clear for existing Firestore users

---

## Detailed Task Breakdown

### Phase 1: Critical Path (4-5 hours)

**T1.1: Restructure README opening for LLM evaluators (lines 1-50)**
- **REMOVE existing WARNING block** with outdated Firestore/GCP references
- **RESTRUCTURE opening** to follow LLM-first pattern:
  1. **Line 1-3**: Concise definition (What is BitBrat? 1-2 sentences)
  2. **Line 4-6**: Experimental status (brief, no tech constraints)
  3. **Line 7-30**: Core concepts table (agent loop stages, key abstractions)
  4. **Line 31+**: Architecture diagram, then details
- **LLM-First Content Pattern**:
  - Definition first: "BitBrat is an event-driven LLM orchestration engine that decomposes the agent loop into independent microservices."
  - Status second: Brief experimental note (2 sentences max)
  - Substance immediately: Core concepts table, architecture, then narrative
- **Key change**: LLM can extract critical info in first 100 words
- Move long-form narrative after technical substance
- Tables and diagrams before prose paragraphs

**T1.2: Update README.md capabilities matrix (lines 236-244)**
- Change "Persistence" row: "PostgreSQL (any managed or self-hosted), Firestore (legacy, GCP-specific, deprecated)"
- Change "Deploy targets" row: "Docker (platform-agnostic: local, cloud, self-hosted). Validated on: Google Cloud Run, AWS ECS, self-hosted Docker Compose (production)"
- Emphasize platform-agnostic design throughout matrix

**T1.3: Update README.md prerequisites (lines 250-263)**
- Move GCP SDK to "Optional" section
- Make OpenAI key optional (Ollama alternative)
- Emphasize: Node, npm, Docker as core requirements

**T1.4: Update README.md setup flow (lines 278-290)**
- De-emphasize GCP Project ID in interactive flow
- Add PostgreSQL connection notes
- Make `brat setup` description PostgreSQL-first

**T1.5: Update quickstart.md**
- Reorder sections: PostgreSQL setup before Firestore
- Make Firestore section "Alternative: Using Firestore (Legacy)"
- Update environment variable examples (PERSISTENCE_DRIVER=postgres)

**T1.6: Update evaluating-bitbrat.md**
- Ensure 5-minute quickstart uses PostgreSQL
- Verify no GCP requirements in fast path

### Phase 2: Core Concepts (3-4 hours)

**T2.1: Update platform-flow.md**
- Diagram update: Show PostgreSQL as persistence layer
- Text references: "Events durably captured in PostgreSQL (or Firestore for legacy deployments)"

**T2.2: Update bit-model.md**
- Update memory/persistence descriptions
- Ensure examples use PostgreSQL

**T2.3: Update README.md architecture diagram (lines 172-232)**
- Change `FS[(Firestore)]` to `DB[(PostgreSQL)]`
- Add note: "PostgreSQL (default) or Firestore (legacy)"

**T2.4: Update agent-flow-stages.md & agent-flow-patterns.md**
- Audit persistence layer references
- Ensure examples are backend-agnostic or PostgreSQL-first

### Phase 3: Guides & Tutorials (4-5 hours)

**T3.1: Update seed-data.md**
- PostgreSQL seeding approach (migrations + initial data)
- Firestore seeding as alternative section

**T3.2: Update backup-and-migration.md**
- Add PostgreSQL backup section (pg_dump, restore)
- Keep Firestore backup sections, mark as legacy

**T3.3: Create postgres-setup.md**
- Local PostgreSQL setup (Docker container)
- Schema management (migrations)
- Connection configuration
- Common operations (psql, queries)

**T3.4: Create docker-production-deployment.md**
- **Platform-agnostic Docker deployment** (core principle)
- Docker Compose for production (any cloud or self-hosted)
- Environment variable configuration
- PostgreSQL connection options: AWS RDS, GCP Cloud SQL, Azure PostgreSQL, self-hosted
- Message bus options: NATS (self-hosted), GCP Pub/Sub, AWS SQS/SNS, Azure Service Bus
- Monitoring and logging (platform-agnostic tools: Prometheus, Grafana, Loki)
- **Platform-specific examples**: GCP Cloud Run, AWS ECS, Azure Container Instances as reference implementations (not requirements)

**T3.5: Update GCP deployment guides**
- Add preamble: "GCP Cloud Run is one validated production platform for BitBrat. BitBrat is platform-agnostic and runs on any platform supporting Docker and PostgreSQL. For platform-agnostic deployment, see docker-production-deployment.md"
- Maintain accuracy of existing content
- Frame GCP as "reference implementation" not default/recommended
- Add cross-references to Docker guides

**T3.6: Audit tutorial files**
- lurk-command.md
- building-an-enrichment-bit.md
- creating-a-domain-mcp-server.md
- creating-a-reflex.md
- Ensure examples use PostgreSQL or are backend-agnostic

### Phase 4: Reference & Technical (2-3 hours)

**T4.1: Audit documentation/firestore/ directory**
- Add deprecation notices to all 3 files
- Cross-reference to PostgreSQL equivalents

**T4.2: Update documentation/tools/firestore-upsert.md**
- Rename to `data-seeding.md` (more generic)
- Add PostgreSQL seeding approach
- Keep Firestore upsert as alternative

**T4.3: Audit documentation/technical-architecture/**
- Update references to persistence layer
- Ensure diagrams/specs reflect current architecture

**T4.4: Audit documentation/services/**
- Update service-specific docs (llm-bot, query-analyzer, persistence, state-engine)
- Ensure persistence backend references are accurate

### Phase 5: Cleanup & Validation (2-3 hours)

**T5.1: Global search audit**
- Search all .md files for "Firestore" - verify each reference
- Search all .md files for "GCP" or "Google Cloud" - verify framing
- Search for "only persistence" or "only supported" - update claims

**T5.2: Create firestore-to-postgres-migration.md**
- Data export from Firestore
- Import to PostgreSQL
- Environment variable changes
- Testing and validation
- Rollback plan

**T5.3: Update code examples**
- Embedded code snippets in documentation
- Ensure they match current API patterns
- Use PostgreSQL examples where persistence shown

**T5.4: Final consistency review**
- Read through all updated files
- Check cross-references are valid
- Ensure tone and messaging consistent

**T5.5: Create documentation verification script**
- Script to check for common issues:
  - "only persistence"
  - "Firestore" without "legacy" or "alternative"
  - "GCP" in prerequisites without "optional"

---

## Risk Assessment & Mitigation

### Risks

**R1: Documentation Divergence**
- **Risk**: Updated docs contradict actual implementation
- **Mitigation**: Cross-reference with architecture.yaml, test actual flows
- **Severity**: High
- **Likelihood**: Medium

**R2: Breaking Existing User Workflows**
- **Risk**: Firestore users feel abandoned or confused
- **Mitigation**: Clear migration guide, keep Firestore docs accurate (but marked legacy)
- **Severity**: Medium
- **Likelihood**: Low (small user base at this stage)

**R3: Incomplete GCP Documentation**
- **Risk**: GCP Cloud Run deployment becomes under-documented
- **Mitigation**: Maintain all existing GCP guides, just reframe positioning
- **Severity**: Medium
- **Likelihood**: Low

**R4: Scope Creep**
- **Risk**: Documentation touches every file, endless refinement
- **Mitigation**: Stick to defined phases, timebox each task
- **Severity**: Low
- **Likelihood**: High

**R5: Inconsistent Tone**
- **Risk**: Some docs say "default PostgreSQL", others "Firestore recommended"
- **Mitigation**: Use search to audit, create tone guidelines, final review pass
- **Severity**: Medium
- **Likelihood**: Medium

### Mitigation Strategies

1. **Early Validation**: Get user sign-off on updated README.md before proceeding to other files
2. **Phased Delivery**: Complete Phase 1 and validate before moving to Phase 2
3. **Automated Checks**: Create grep-based validation script to catch inconsistencies
4. **Migration Path**: Prioritize clear Firestore→PostgreSQL migration guide
5. **Preserve Accuracy**: All GCP content remains accurate, just repositioned

---

## Success Criteria

### Must-Have (Sprint 345)
1. ✅ README.md accurately reflects PostgreSQL as default
2. ✅ README.md doesn't require GCP for local development
3. ✅ quickstart.md uses PostgreSQL in primary path
4. ✅ Architecture diagrams show PostgreSQL
5. ✅ Capabilities matrix updated
6. ✅ Migration guide exists (Firestore → PostgreSQL)

### Should-Have (Sprint 345)
7. ✅ All tutorials use PostgreSQL examples
8. ✅ Firestore docs marked as legacy
9. ✅ Docker production deployment guide exists
10. ✅ PostgreSQL setup guide exists
11. ✅ Seed data documentation updated

### Nice-to-Have (Sprint 345 or later)
12. ⚠️ Automated documentation consistency checks
13. ⚠️ All technical architecture docs audited
14. ⚠️ Code examples in all files updated

---

## Rollout Plan

### Phase 1 Validation (After 5 hours)
- **Deliverable**: Updated README.md, quickstart.md, evaluating-bitbrat.md
- **Validation**: User reviews entry-point docs, approves tone and positioning
- **Go/No-Go**: User approval required before Phase 2

### Phase 2-3 Review (After 10 hours)
- **Deliverable**: Concept docs, guides, tutorials updated
- **Validation**: Spot-check guides for accuracy, test a tutorial end-to-end
- **Go/No-Go**: Functionality verification before Phase 4

### Final Review (After 15 hours)
- **Deliverable**: All files updated, migration guide complete
- **Validation**: Run verification script, user final review
- **Go/No-Go**: User approval for commit/push

---

## Estimated Timeline

| Phase | Tasks | Estimated Hours | Cumulative |
|-------|-------|----------------|------------|
| Phase 1 | Critical Path | 4-5 | 5 |
| Phase 2 | Core Concepts | 3-4 | 9 |
| Phase 3 | Guides & Tutorials | 4-5 | 14 |
| Phase 4 | Reference & Technical | 2-3 | 17 |
| Phase 5 | Cleanup & Validation | 2-3 | 20 |

**Target**: 12-16 hours (phases 1-4)
**Stretch**: 18-20 hours (including comprehensive phase 5)

---

## Out of Scope (Future Sprints)

The following are explicitly **not** included in Sprint 345:

1. Creating new PostgreSQL features/tooling (implementation work)
2. Deprecating/removing Firestore code from codebase
3. Migrating production deployments from Firestore to PostgreSQL
4. Creating video tutorials or interactive documentation
5. Translating documentation to other languages
6. Updating external blog posts or marketing materials
7. Refactoring code examples into separate executable test files

---

## Dependencies

### Required for Sprint Start
- ✅ Sprint 344 complete (PostgreSQL as default implemented)
- ✅ Current documentation state analyzed
- ✅ User approval of execution plan

### Required During Sprint
- Access to verify actual implementation (test PostgreSQL setup)
- User availability for phase validation checkpoints
- Ability to run `brat` commands to verify documentation accuracy

### Blocking Issues
- None identified

---

## Deliverables

### Documentation Files (Updated)
1. README.md
2. CLAUDE.md (minor updates)
3. documentation/getting-started/quickstart.md
4. documentation/getting-started/evaluating-bitbrat.md
5. documentation/concepts/bit-model.md
6. documentation/concepts/platform-flow.md
7. documentation/guides/seed-data.md
8. documentation/guides/backup-and-migration.md
9. Multiple tutorial files
10. Multiple reference files

### Documentation Files (New)
11. documentation/guides/postgres-setup.md
12. documentation/guides/docker-production-deployment.md
13. documentation/guides/firestore-to-postgres-migration.md

### Scripts (New)
14. tools/validate-documentation-consistency.sh

### Sprint Artifacts
15. planning/sprint-345-documentation-update/execution-plan.md (this file)
16. planning/sprint-345-documentation-update/backlog.yaml
17. planning/sprint-345-documentation-update/request-log.md
18. planning/sprint-345-documentation-update/verification-report.md (end of sprint)

---

## Notes

- Documentation is user-facing and high-visibility - accuracy is critical
- Maintain empathy for existing Firestore users - provide clear migration path
- GCP remains a first-class deployment option - just not the *only* option
- This sprint focuses on documentation, not implementation changes
