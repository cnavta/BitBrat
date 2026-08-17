# BitBrat Documentation Analysis
**Sprint:** Documentation Refactor - Platform vs Domain Bits
**Date:** 2026-07-07
**Role:** Technical Writer

## Executive Summary

The BitBrat platform has evolved significantly with the introduction of the Reflex bit and the solidification of the Bit model architecture. The current documentation does not adequately reflect the emerging distinction between **Platform Bits** (core agent orchestration) and **Domain Bits** (optional capabilities). This analysis identifies gaps, inconsistencies, and proposes a comprehensive refactor to weave this architectural distinction throughout all documentation.

---

## Current Documentation State

### Strengths

1. **Well-Structured Foundation**
   - Clear separation between concepts, guides, tutorials, and reference docs
   - Strong foundational documents: README.md, bit-model.md, platform-flow.md
   - Comprehensive CLAUDE.md for LLM-assisted development
   - Good coverage of the Bit model and `bit.*` control plane

2. **Existing Architectural Hooks**
   - `profile:` field in architecture.yaml (core, gateway, llm, mcp-server)
   - `mcp.exposure:` field (platform-only, platform+domain)
   - `stage:` field (ingest, route, analyze, react, persist, egress)
   - These provide a foundation for Platform vs Domain categorization

3. **Recent Updates**
   - Bit model documentation is current (sprint-324)
   - MCP control plane is well-documented
   - Capability profiles are documented

### Critical Gaps

1. **Platform vs Domain Distinction Not Codified**
   - No explicit categorization of which Bits are "Platform" vs "Domain"
   - README lists services but doesn't explain their architectural role
   - Platform flow diagram doesn't distinguish core vs optional components
   - No clear guidance on what makes a Bit "platform" vs "domain"

2. **Reflex Bit Not Documented**
   - No dedicated concept page for Reflex
   - Not mentioned in README architecture section
   - Not included in platform flow diagrams
   - Missing from the "perceive → plan → act → observe" mapping
   - No explanation of deterministic vs LLM-based execution paths

3. **Inconsistent Service Listings**
   - README lists some services in architecture section, omits others
   - No clear criteria for which services are "core" to the agent loop
   - MCP servers (obs-mcp, image-gen-mcp, story-engine-mcp) treated as afterthoughts

4. **Architecture Diagrams Need Updates**
   - Mermaid diagram in README doesn't show reflex
   - Platform flow needs two paths: deterministic (reflex) and LLM-based
   - No visual distinction between Platform and Domain Bits

5. **Conceptual Clarity Needed**
   - When should a developer create a Platform Bit vs Domain Bit?
   - What's the architectural boundary between them?
   - How does reflex change the "perceive → plan → act" model?

---

## Platform Bits vs Domain Bits Analysis

### Platform Bits (Core Agent Orchestration - 10 services)

These Bits form the essential **perceive → plan → act → observe** agent loop and platform control infrastructure. They are tightly coupled to the core orchestration flow.

| Bit | Profile | Stage | Role in Agent Loop |
|-----|---------|-------|-------------------|
| **ingress-egress** | gateway | ingest, egress | **Perceive** - Normalizes external events into Envelope v1; **Observe** - Delivers responses |
| **event-router** | gateway | route | **Plan** - Evaluates rules, attaches routing slips, orchestrates flow |
| **auth** | gateway | route | **Plan** - Enriches events with user identity/roles |
| **llm-bot** | llm | analyze | **Act** - LLM reasoning and tool selection |
| **query-analyzer** | llm | analyze | **Act** - Fast pre-analysis for routing hints |
| **reflex** | mcp-server | analyze | **Act** - Deterministic pattern-match execution (<150ms, no LLM) |
| **tool-gateway** | gateway | (fabric) | **Act** - MCP tool proxy, RBAC enforcement, discovery |
| **state-engine** | mcp-server | react | **Observe** - Persistent state mutations |
| **persistence** | core | persist | **Observe** - Event audit trail, long-term memory |
| **api-gateway** | gateway | ingest, egress | **Perceive/Observe** - HTTP/WebSocket event source |

**Rationale:** These 10 Bits form the minimal viable agent. Remove any one and core orchestration breaks.

### Domain Bits (Optional Capabilities - 6+ services)

These Bits extend the platform with domain-specific capabilities but are not required for the core agent loop.

| Bit | Profile | Purpose | Removable? |
|-----|---------|---------|-----------|
| **obs-mcp** | mcp-server | OBS Studio control tools | ✓ Yes - streaming-specific |
| **image-gen-mcp** | mcp-server | DALL-E image generation | ✓ Yes - creative domain |
| **story-engine-mcp** | mcp-server | Collaborative storytelling | ✓ Yes - narrative domain |
| **stream-analyst** | llm | Stream analytics/summarization | ✓ Yes - analytics domain |
| **disposition-service** | core | Short-term user behavior patterns | ✓ Yes - behavioral analysis |
| **scheduler** | mcp-server | Periodic tasks/ticks | ✓ Yes - automation domain |
| **oauth-flow** | gateway | OAuth2 authentication flows | ✓ Yes - authentication domain |

**Rationale:** These Bits add capabilities but the core agent loop functions without them. They represent domain extensions.

---

## Dual Execution Paths

The introduction of Reflex creates **two execution paths** through the platform:

### Path 1: Deterministic (Reflex)
```
Perceive (ingress) → Plan (router) → Match (reflex) → Execute Tool → Observe (persistence)
Timeline: <150ms total
Use Case: Repeated, predictable behaviors (chat commands, simple automations)
Cost: Low (no LLM calls)
```

### Path 2: LLM-Based (Traditional)
```
Perceive (ingress) → Plan (router) → Analyze (llm-bot/query-analyzer) → Tool Selection → Execute → Observe
Timeline: 2-10 seconds
Use Case: Novel situations, complex reasoning, creative responses
Cost: Higher (LLM API calls)
```

**Both paths**:
- Share the same ingress/router/persistence infrastructure
- Use the same MCP tool fabric (tool-gateway)
- Publish to the same egress mechanism
- Follow the same Envelope v1 message contract

This **dual-path architecture** is a key insight that must be woven into documentation.

---

## Key Documentation Gaps

### 1. Missing Concept Pages
- **Reflex Deterministic Execution** - What reflexes are, when to use them vs LLM
- **Platform vs Domain Architecture** - Clear definition and examples
- **Dual Execution Paths** - Deterministic vs LLM-based flows

### 2. README Updates Needed
- Add reflex to architecture section and agent-loop mapping table
- Update mermaid diagram to show both execution paths
- Categorize services as Platform (core) vs Domain (extensions)
- Update "Extending BitBrat" section with Platform/Domain guidance

### 3. Platform Flow Updates
- Split diagram into two paths (deterministic and LLM-based)
- Show reflex as parallel to llm-bot in the analyze stage
- Clarify when each path is taken (routing rules)

### 4. Bit Model Updates
- Add guidance on when to create Platform vs Domain Bits
- Update examples to show both categories
- Clarify that `mcp-server` profile doesn't mean "Domain Bit"

### 5. architecture.yaml Documentation
- Add `category: platform|domain` field to service definitions
- Document the categorization in llm_guidance.glossary
- Update defaults and examples

---

## Inconsistencies to Address

1. **Profile vs Category Confusion**
   - `profile: mcp-server` is a capability mixin, NOT a category
   - Both Platform and Domain Bits can have `profile: mcp-server`
   - Example: `reflex` (Platform) and `obs-mcp` (Domain) both use `mcp-server`

2. **Stage vs Role**
   - `stage:` describes where in the event lifecycle a Bit operates
   - Category (Platform/Domain) describes architectural role
   - These are orthogonal concerns

3. **Exposure vs Category**
   - `mcp.exposure: platform+domain` means "serve domain tools via MCP"
   - It does NOT mean the Bit itself is a "Domain Bit"
   - Both Platform and Domain Bits can have `platform+domain` exposure

4. **External Dependencies**
   - `external:` field lists external services (twitch, openai, obs)
   - This correlates with Domain Bits but isn't definitive
   - Platform Bits can have external dependencies (e.g., LLM providers)

---

## Proposed Categorization Criteria

### A Bit is "Platform" if:
1. Required for the core agent loop (perceive → plan → act → observe)
2. Removal would break fundamental orchestration
3. Provides infrastructure other Bits depend on (message bus integration, MCP fabric)
4. Part of the "minimal viable agent" configuration

### A Bit is "Domain" if:
1. Adds optional capabilities or domain-specific tools
2. Can be removed without breaking core orchestration
3. Serves a specific use case or vertical (streaming, storytelling, automation)
4. Extends the platform rather than enabling it

### Gray Areas to Clarify
- **disposition-service**: Currently Platform, could be Domain (behavioral analysis is optional)
- **api-gateway**: Platform (alternate ingress/egress) or Domain (HTTP interface extension)?
- **scheduler**: Domain (periodic tasks are optional) but foundational for some use cases

**Recommendation**: Document the criteria and list current categorization with rationale. Allow for evolution.

---

## Documentation Structure Recommendations

### New/Updated Pages Needed

1. **documentation/concepts/platform-vs-domain-bits.md** (NEW)
   - Define Platform vs Domain categories
   - List current categorization with rationale
   - Guidance for choosing category when creating Bits
   - Examples of each

2. **documentation/concepts/reflex-deterministic-execution.md** (NEW)
   - What reflexes are and how they work
   - Pattern matching and MCP tool execution
   - Performance characteristics (<150ms)
   - When to use reflex vs LLM
   - Integration with event router

3. **documentation/concepts/dual-execution-paths.md** (NEW)
   - Deterministic path (reflex)
   - LLM-based path (llm-bot/query-analyzer)
   - Decision criteria for routing
   - Performance and cost trade-offs

4. **README.md** (UPDATE)
   - Revise architecture section to categorize services
   - Update mermaid diagram with both paths
   - Add reflex to agent-loop mapping table
   - Update "Extending BitBrat" section

5. **documentation/concepts/platform-flow.md** (UPDATE)
   - Add dual-path diagram
   - Show reflex parallel to llm-bot
   - Clarify routing decisions

6. **documentation/concepts/bit-model.md** (UPDATE)
   - Add Platform vs Domain section
   - Clarify profile vs category distinction
   - Update examples

7. **architecture.yaml** (UPDATE)
   - Add `category: platform|domain` field
   - Document in llm_guidance.glossary
   - Add to all service definitions

---

## Success Criteria

Documentation refactor is complete when:

✓ All services are explicitly categorized as Platform or Domain in architecture.yaml
✓ README clearly explains the Platform vs Domain distinction
✓ README includes reflex in architecture and agent-loop mapping
✓ Platform flow diagram shows dual execution paths
✓ Three new concept pages exist (platform-vs-domain, reflex, dual-paths)
✓ Bit model documentation clarifies category vs profile
✓ Extending BitBrat section provides guidance on Platform vs Domain creation
✓ CLAUDE.md updated with new terminology
✓ All diagrams updated to reflect current architecture
✓ Cross-references between docs are consistent

---

## Next Steps

1. Review this analysis with stakeholders
2. Create detailed execution plan
3. Create prioritized YAML backlog
4. Begin implementation in priority order
5. Validate with test readers (developers new to platform)
6. Update as platform evolves

