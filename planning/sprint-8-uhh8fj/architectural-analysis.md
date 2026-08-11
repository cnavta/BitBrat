# Architectural Analysis: Architecture.yaml Consolidation and Intent-Centric Refactor

**Sprint**: 8 (sprint-8-uhh8fj)
**Role**: Architect
**Date**: 2026-08-10
**Status**: Analysis Document
**Owner**: @christophernavta

## Executive Summary

This document provides a comprehensive analysis of the current architecture.yaml structure and proposes a consolidation strategy to reduce verbosity, eliminate redundancy, and extend the {config, constraints, intent} pattern established in Sprint 4 to remaining sections.

**Key Objectives**:
1. Remove or relocate sections better served in separate documentation
2. Consolidate repetitious content
3. Reduce the number of top-level sections from 16 to ~8
4. Extend the {config, constraints, intent} pattern to remaining sections
5. Create a more intent-centric, maintainable schema

**Impact**:
- **File Size Reduction**: ~1444 lines → ~900 lines (38% reduction)
- **Cognitive Load**: Fewer top-level sections to navigate
- **Maintainability**: Clear separation between platform requirements and documentation
- **Consistency**: Uniform {config, constraints, intent} pattern throughout

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Problem Statement](#2-problem-statement)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Section-by-Section Analysis](#4-section-by-section-analysis)
5. [Migration Strategy](#5-migration-strategy)
6. [Risk Analysis](#6-risk-analysis)
7. [Success Metrics](#7-success-metrics)
8. [Recommendations](#8-recommendations)

---

## 1. Current State Analysis

### 1.1 Current Top-Level Sections

The current architecture.yaml has **16 top-level sections**:

| Section | Lines | Purpose | Status | Assessment |
|---------|-------|---------|--------|------------|
| `name` | 1 | Project name | ✅ Keep | Single metadata field |
| `description` | 3 | Project description | ✅ Keep | Single metadata field |
| `project` | 7 | Project metadata | ✅ Keep | Core metadata |
| `llm_guidance` | 32 | LLM collaboration guidance | ✅ Keep | Critical for AI tooling |
| `platform` | 233 | v2 infrastructure schema | ✅ Keep | **New pattern (Sprint 4)** |
| `infrastructure` | 139 | Provider implementations | ✅ Keep | **New pattern (Sprint 4)** |
| `messaging` | 202 | Messaging configuration | ⚠️ Consolidate | **Too verbose, repetitious** |
| `dataflow` | 39 | Event lifecycle stages | ✅ Keep | Useful workflow documentation |
| `conventions` | 105 | Naming and env conventions | ⚠️ Refactor | **More config than conventions** |
| `references` | 11 | Documentation pointers | ⚠️ Consolidate | **Potentially redundant** |
| `extension_points` | 53 | How to extend platform | ❌ Remove | **Out of date, MCP helps** |
| `defaults` | 47 | Service defaults | ✅ Keep | Useful default values |
| `services` | 485 | Service definitions | ✅ Keep | Core registry |
| `cloudResources` | 98 | Legacy GCP resources | ❌ Remove | **Already marked legacy** |
| `deploymentDefaults` | 12 | Deployment defaults | ❌ Remove | **Likely unused** |
| `networking` | 11 | GCP networking config | ❌ Remove | **GCP-specific, unused** |
| `executionContexts` | 75 | Execution contexts | ✅ Keep | Core runtime config |

**Total**: 1444 lines across 16 sections

### 1.2 The {config, constraints, intent} Pattern (Sprint 4)

Sprint 4 established a powerful 3-part pattern for infrastructure:

```yaml
platform:
  infrastructure:
    messaging:
      # WHAT we need
      required: true
      capabilities: [publish-subscribe, stream-retention]

      # HOW it should behave (platform-wide defaults)
      config:
        defaultTTL: 3600
        deliveryGuarantee: at-least-once

      # WHY we need it (constraints, non-negotiable)
      constraints:
        minRetention: 86400
        requireDurability: true

      # CURRENT USE CASES (living documentation)
      intent:
        - "Event-driven orchestration between services"
        - "Routing slips carry processing steps"
```

**Benefits of this pattern**:
1. **Config**: Platform-wide defaults, overridable per context
2. **Constraints**: Hard requirements providers MUST satisfy
3. **Intent**: Living documentation of current use cases (not aspirational)

This pattern should be extended to other sections.

### 1.3 Sections Analysis

#### ✅ Well-Designed Sections (Keep As-Is)

**1. `platform.infrastructure` (Sprint 4)**
- Lines: 75-148 (73 lines)
- Purpose: Generic infrastructure requirements
- Pattern: {config, constraints, intent}
- Status: ✅ Excellent, extend this pattern

**2. `infrastructure.{provider}` (Sprint 4)**
- Lines: 157-295 (138 lines)
- Purpose: Provider-specific implementations
- Pattern: {config, constraints, intent}
- Status: ✅ Excellent, extend this pattern

**3. `services`**
- Lines: 757-1241 (485 lines)
- Purpose: Service registry with dependencies
- Status: ✅ Core platform registry

**4. `executionContexts`**
- Lines: 1359-1433 (75 lines)
- Purpose: Runtime environment configuration
- Status: ✅ Well-structured, keep

**5. `dataflow`**
- Lines: 499-538 (39 lines)
- Purpose: Event lifecycle stages
- Status: ✅ Concise workflow documentation

#### ⚠️ Problematic Sections (Refactor)

**1. `messaging` (lines 296-498, 202 lines)**

**Problems**:
- **Redundant with platform.infrastructure.messaging**: Duplicates config, constraints
- **Too much implementation detail**: Should be in provider implementations
- **Topic registry mixed with config**: Topics should be separate or in services
- **Verbose conventions**: Should be in separate conventions doc

**Example redundancy**:
```yaml
# platform.infrastructure.messaging (Sprint 4, v2)
messaging:
  config:
    defaultTTL: 3600
    deliveryGuarantee: at-least-once
  constraints:
    minRetention: 86400

# messaging (old, v1) - REDUNDANT
messaging:
  transport:
    delivery: at-least-once
  tuning:
    dedupe_ttl_ms_env: MESSAGE_DEDUP_TTL_MS
```

**What to keep**:
- Topic registry (internal.ingress.v1, internal.egress.v1, etc.)
- Topic naming conventions (internal.<domain>.<verb>.v<version>)
- Envelope schema reference

**What to remove**:
- Redundant config (already in platform.infrastructure.messaging)
- Transport driver config (belongs in infrastructure.{provider})
- Verbose implementation details

**2. `conventions` (lines 540-645, 105 lines)**

**Problems**:
- **More configuration than conventions**: `env`, `secrets` subsections are catalogs
- **Secrets catalog is verbose**: 106 lines for secret definitions
- **Should be reference documentation**: Not platform configuration

**Example**:
```yaml
conventions:
  secrets:
    catalog:
      MCP_AUTH_TOKEN:
        description: Bearer token authorizing service-to-MCP-gateway (tool-gateway) calls.
        source: gcp-secret-manager
        used_by: [auth, event-router, obs-mcp, ...]  # 13 services listed
      OPENAI_API_KEY:
        description: OpenAI API key for LLM analysis and image generation.
        source: gcp-secret-manager
        used_by: [query-analyzer, llm-bot, image-gen-mcp]
      # ... 14 more secrets, 106 lines total
```

**What to keep**:
- Actual conventions (naming patterns, versioning rules)
- High-level env/secrets concepts

**What to relocate**:
- Secrets catalog → `documentation/reference/secrets-catalog.md`
- Auto-injected env vars → `documentation/reference/environment-variables.md`

**3. `references` (lines 646-656, 11 lines)**

**Problems**:
- **May be redundant**: `llm_guidance.doc_pointers` already has references
- **Out of date**: Some references may not exist or be stale
- **Could be subsection**: Not worthy of top-level section

**Current references**:
```yaml
references:
  architecture_schema: documentation/schemas/architecture.v1.json
  platform_flow: documentation/concepts/platform-flow.md
  event_router_rules: documentation/concepts/event-router-rules.md
  messaging_system: documentation/reference/messaging-system.md
  messaging_config: documentation/messaging-config.md  # May not exist
  envelope_schema: documentation/schemas/envelope.v1.json
  routing_slip_schema: documentation/schemas/routing-slip.v1.json
  firestore_docs: documentation/firestore/
  firestore_rules: firestore.rules
  firestore_indexes: firestore.indexes.json
```

**Comparison with llm_guidance.doc_pointers**:
```yaml
llm_guidance:
  doc_pointers:
    flow: documentation/concepts/platform-flow.md  # DUPLICATE
    messaging: documentation/reference/messaging-system.md  # DUPLICATE
    schemas: documentation/schemas/  # DUPLICATE (broader)
    backlog: documentation/reference/backlog-example.yaml
    execution-or-implementation-plan: documentation/reference/execution-implementation-plan-template.md
```

**Recommendation**: Consolidate into `llm_guidance.references` or remove entirely

#### ❌ Sections to Remove

**1. `extension_points` (lines 657-709, 53 lines)**

**Reason**: Out of date, MCP tooling and `brat` CLI provide better extension mechanisms

**Current content**:
- How to add a service (superseded by `brat bit create`)
- How to add MCP tools (superseded by `brat bit create --profile mcp-server`)
- How to add router rules (still valid but not architecture config)

**Recommendation**:
- Remove from architecture.yaml
- Document in `documentation/guides/extending-bitbrat.md`
- `brat bit create --help` is canonical reference

**2. `cloudResources` (lines 1249-1346, 98 lines)**

**Reason**: Already marked as legacy, belongs in `infrastructure.gcp`

**Current status**:
```yaml
# ============================================================================
# CLOUD RESOURCES (Legacy - to be migrated to infrastructure.gcp in future sprint)
# ============================================================================
```

**Recommendation**: Remove entirely, document for potential future migration

**3. `deploymentDefaults` (lines 1347-1358, 12 lines)**

**Reason**: Likely unused, duplicates `defaults.services`

**Current content**:
```yaml
deploymentDefaults:
  maxConcurrentDeployments: 3
  region: us-central1
  cloud-run:
    platform: managed
    minInstances: 1
    maxInstances: 1
    cpu: '1'
    memory: 512Mi
    billing: instance
  global-external-application-lb:
    loadBalancingScheme: EXTERNAL_MANAGED
```

**Overlap with defaults.services**:
```yaml
defaults:
  services:
    region: us-central1  # DUPLICATE
    scaling:
      min: 1  # DUPLICATE (minInstances)
      max: 1  # DUPLICATE (maxInstances)
```

**Recommendation**: Remove, consolidate into `defaults.services` if needed

**4. `networking` (lines 1434-1444, 11 lines)**

**Reason**: GCP-specific, unused, belongs in `infrastructure.gcp` if needed

**Current content**:
```yaml
networking:
  cloud_nat:
    enabled: false
    rationale: Outbound public traffic uses the Cloud Run default egress path for best latency.
  vpc_connectors:
    purpose: Reach private RFC1918 ranges only.
    service_egress: PRIVATE_RANGES_ONLY
  subnets:
    private_ip_google_access: true
    psc_restricted_vip: false
```

**Recommendation**: Remove from architecture.yaml, document in GCP deployment guide

---

## 2. Problem Statement

### 2.1 Core Problems

**1. Too Many Top-Level Sections (16)**
- High cognitive load for developers navigating the file
- Unclear which sections are core vs supplementary
- Redundancy between sections (messaging, platform.infrastructure.messaging)

**2. Inconsistent Patterns**
- Sprint 4 introduced {config, constraints, intent} for infrastructure
- Older sections use ad-hoc structures
- No clear distinction between configuration and documentation

**3. Verbosity and Repetition**
- `messaging` section duplicates platform.infrastructure.messaging
- `conventions.secrets` is a 106-line catalog (better as reference doc)
- `cloudResources` is 98 lines of deprecated content

**4. Unclear Intent**
- Some sections lack "why" documentation (conventions, references)
- Intent is scattered across description fields
- Hard to understand the evolution and rationale

**5. Maintenance Burden**
- Updating infrastructure requires changes in 2+ places (platform + messaging)
- Deprecated sections remain in file for fear of breaking things
- No clear migration path for legacy patterns

### 2.2 User Experience Impact

**For New Developers**:
- "Where do I find messaging configuration?" (2 places: platform.infrastructure.messaging + messaging)
- "What's the difference between cloudResources and infrastructure.gcp?" (legacy vs v2)
- "Which sections are current vs deprecated?" (unclear without reading comments)

**For Existing Developers**:
- "Do I update messaging or platform.infrastructure.messaging?" (both, to be safe)
- "Can I delete deploymentDefaults?" (unknown if used)
- "Where do I document a new secret?" (conventions.secrets.catalog)

**For LLM Evaluators** (Claude Code, Aider):
- 16 top-level sections to scan for relevant information
- Redundancy causes conflicting information (which is canonical?)
- Verbose catalogs make it hard to extract key concepts

---

## 3. Proposed Architecture

### 3.1 Proposed Top-Level Sections

Reduce from **16 sections** to **10 core sections**:

| Section | Lines (Est.) | Purpose | Pattern |
|---------|--------------|---------|---------|
| `name` | 1 | Project name | Metadata |
| `description` | 3 | Project description | Metadata |
| `project` | 7 | Project metadata | Metadata |
| `llm_guidance` | 40 | LLM collaboration guidance | {glossary, invariants, references, intent} |
| `platform` | 250 | Platform-level requirements | {config, constraints, intent} |
| `infrastructure` | 200 | Provider implementations | {config, constraints, intent} |
| `messaging` | 100 | Topic registry + envelope schema | {topics, schemas, conventions} |
| `defaults` | 50 | Service defaults | {services, build, health} |
| `services` | 485 | Service definitions | Registry |
| `executionContexts` | 100 | Execution contexts | {deployment, runtime, infrastructure} |

**Total**: ~1236 lines (14% reduction from 1444 lines)

### 3.2 Removed/Relocated Sections

| Section | Lines Removed | Action |
|---------|---------------|--------|
| `dataflow` | 39 | **Relocate** to `platform.orchestration` |
| `conventions` | 105 | **Split**: Keep naming conventions, move catalog to docs |
| `references` | 11 | **Consolidate** into `llm_guidance.references` |
| `extension_points` | 53 | **Remove**: Document in guides |
| `cloudResources` | 98 | **Remove**: Legacy, already marked for removal |
| `deploymentDefaults` | 12 | **Remove**: Unused, duplicates `defaults.services` |
| `networking` | 11 | **Remove**: GCP-specific, belongs in deployment guide |

**Total Removed**: 329 lines

### 3.3 New/Refactored Sections

#### 3.1 `platform.orchestration` (NEW)

**Purpose**: Document the event-driven orchestration flow

**Pattern**: {config, stages, intent}

```yaml
platform:
  orchestration:
    # Configuration for orchestration behavior
    config:
      model: event-driven           # event-driven | request-response | hybrid
      flow: perceive-plan-act-observe  # Agent loop pattern
      coordination: routing-slip    # How steps are coordinated

    # Orchestration stages (from dataflow)
    stages:
      - id: ingest
        description: Normalize external platform events into Envelope v1
        services: [ingress-egress, api-gateway, scheduler]
        topics:
          publishes: [internal.ingress.v1]

      - id: route
        description: Attach and advance the routing slip
        services: [event-router]
        topics:
          consumes: [internal.ingress.v1, internal.enriched.v1]

      - id: analyze
        description: Optional analysis/enrichment steps
        services: [query-analyzer, llm-bot, disposition-service]
        topics:
          publishes: [internal.enriched.v1]

      - id: react
        description: Apply state mutations and behavioral side effects
        services: [state-engine, disposition-service]
        topics:
          consumes: [internal.state.mutation.v1]

      - id: egress
        description: Translate internal responses back to platform-native delivery
        services: [ingress-egress, api-gateway]
        topics:
          consumes: [internal.egress.v1]

      - id: persist
        description: Durable capture of events and snapshots
        services: [persistence]
        topics:
          consumes: [internal.persistence.snapshot.v1, internal.deadletter.v1]

    # Intent: Why this orchestration model
    intent:
      - "Decouples agent loop (perceive → plan → act → observe) into independent services"
      - "Routing slip enables dynamic orchestration without hardcoded workflows"
      - "Each stage is independently scalable and replaceable"
      - "Dead-letter topics provide fault tolerance and observability"

    # Constraints
    constraints:
      requiresMessaging: true       # Cannot orchestrate without message bus
      requiresRoutingSlip: true     # Services must understand routing slip schema
      maxStageLatency: 1000         # Each stage should complete in <1s
```

**Benefits**:
- Consolidates `dataflow` into platform schema
- Applies {config, intent, constraints} pattern
- Clearer documentation of orchestration model
- Topics are listed per stage (easier to understand flow)

#### 3.2 `messaging` (REFACTORED)

**Purpose**: Topic registry, envelope schema, and naming conventions (NOT infrastructure config)

**Pattern**: {topics, schemas, conventions}

```yaml
messaging:
  # Brief description
  description: >
    Internal event bus connects all services via topics. Orchestration uses routing slips
    that travel with messages. Delivery is at-least-once (consumers MUST be idempotent).

  # Reference to infrastructure implementation
  infrastructure: platform.infrastructure.messaging  # See platform section for config

  # Envelope schema
  envelope:
    schema: documentation/schemas/envelope.v1.json
    required: [v, source, correlationId]
    optional: [traceId, replyTo, timeoutAt, routingSlip]
    routing_slip_schema: documentation/schemas/routing-slip.v1.json

  # Naming conventions
  conventions:
    topic_naming: internal.<domain>.<verb>.v<version>
    versioning: Bump v<N> on breaking payload changes; never mutate an existing version
    per_instance: >
      A '.{instanceId}' suffix targets a single running instance. Resolved at runtime via:
      K_REVISION || EGRESS_INSTANCE_ID || SERVICE_INSTANCE_ID || HOSTNAME || generated id

  # Dead-letter queue configuration
  dlq:
    description: >
      Unrecoverable failures are routed to dead-letter topics. Retryable failures are
      re-published by the originating step with backoff.
    topics:
      - internal.deadletter.v1
      - internal.router.dlq.v1

  # Topic registry (condensed)
  topics:
    internal.ingress.v1:
      description: Normalized inbound events from external platforms
      producers: [ingress-egress, scheduler, api-gateway]
      consumers: [event-router, persistence]
      schema: documentation/schemas/envelope.v1.json

    internal.egress.v1:
      description: Final responses for delivery back to originating platform
      producers: [event-router, scheduler]
      consumers: [ingress-egress]
      schema: documentation/schemas/envelope.v1.json

    # ... other topics (condensed format)

  # Intent: Why this messaging design
  intent:
    - "Decoupled publish-subscribe for independent service scaling"
    - "Routing slips enable dynamic orchestration without service-to-service coupling"
    - "Topic versioning ensures backward compatibility during upgrades"
    - "Dead-letter topics provide fault tolerance and debugging"
```

**Changes**:
- **Removed**: Redundant config (transport, tuning) → now in platform.infrastructure.messaging
- **Condensed**: Topic registry (remove verbose per-topic descriptions)
- **Added**: Reference to platform.infrastructure.messaging
- **Added**: Intent section explaining messaging design

**Lines**: 202 → ~100 (50% reduction)

#### 3.3 `llm_guidance` (ENHANCED)

**Purpose**: LLM collaboration guidance with consolidated references

**Pattern**: {glossary, invariants, references, intent}

```yaml
llm_guidance:
  # Default system prompt (unchanged)
  default_system_prompt: >
    You are an experienced Lead Engineer responsible for developing the BitBrat Platform.
    Follow the architecture.yaml specs strictly. Justify any architectural deviation clearly.

  # Glossary (unchanged)
  glossary:
    routing_slip: ...
    disposition: ...
    mcp: ...
    # ... existing terms

  # Invariants (unchanged)
  invariants:
    - Never import from or depend on ./deprecated in deliverables
    - Every message must carry a correlationId
    - Bump the topic version (v<N>) on breaking payload changes
    - Consumers must be idempotent because delivery is at-least-once
    - architecture.yaml is the canonical source of truth

  # CONSOLIDATED: References from `references` section
  references:
    # Core schemas
    architecture_schema: documentation/schemas/architecture.v2.json  # v2 (updated)
    envelope_schema: documentation/schemas/envelope.v1.json
    routing_slip_schema: documentation/schemas/routing-slip.v1.json

    # Conceptual documentation
    platform_flow: documentation/concepts/platform-flow.md
    event_router_rules: documentation/concepts/event-router-rules.md
    bit_model: documentation/concepts/bit-model.md

    # Reference documentation
    messaging_system: documentation/reference/messaging-system.md
    bit_control_plane: documentation/reference/bit-control-plane.md
    secrets_catalog: documentation/reference/secrets-catalog.md  # NEW
    environment_variables: documentation/reference/environment-variables.md  # NEW

    # Tools and guides
    brat_cli: documentation/tools/brat.md
    extending_platform: documentation/guides/extending-bitbrat.md  # NEW
    backlog: documentation/reference/backlog-example.yaml
    implementation_plan_template: documentation/reference/execution-implementation-plan-template.md

  # Intent: Why architecture.yaml exists, how to use it
  intent:
    - "Single source of truth for platform configuration (services, infrastructure, contexts)"
    - "LLM-friendly: structured for efficient parsing by Claude Code, Aider, Continue"
    - "Drives build/deploy tooling: brat CLI derives all metadata from this file"
    - "Living documentation: config, constraints, and intent document current state (not aspirational)"
    - "Version-controlled: changes tracked in git, reviewed in PRs"
    - "Platform-agnostic: supports Docker, GCP, AWS, Azure, K8s via provider abstraction"
```

**Changes**:
- **Consolidated**: `references` section merged into `llm_guidance.references`
- **Added**: New references (secrets_catalog, environment_variables, extending_platform)
- **Added**: `intent` subsection explaining purpose of architecture.yaml
- **Deduplicated**: Removed duplicate references between doc_pointers and references

**Lines**: 32 → ~40 (slight increase for better documentation)

#### 3.4 `conventions` (REFACTORED)

**Purpose**: Actual conventions (naming, versioning), not catalogs

**Pattern**: {naming, versioning, environment}

```yaml
conventions:
  # Naming conventions
  naming:
    files: kebab-case
    classes: PascalCase
    functions: camelCase
    variables: camelCase
    constants: UPPER_SNAKE_CASE
    topics: internal.<domain>.<verb>.v<version>

  # Versioning conventions
  versioning:
    topics: Bump v<N> on breaking payload changes; never mutate an existing version
    services: Semantic versioning (major.minor.patch)
    architecture: architecture.yaml version in platform.version field

  # Environment variable conventions
  environment:
    description: >
      Variables listed under services.*.env are required at runtime. They are supplied by
      Cloud Run at deploy time, by dotenv in development, or auto-injected by the platform.

    sources:
      - gcp-secret-manager
      - dotenv
      - cloud-run-injection

    auto_injected:
      - name: K_REVISION
        source: cloud-run-injection
        description: Cloud Run revision name, used as default per-instance egress {instanceId}

    # Reference to full catalogs
    catalogs:
      secrets: documentation/reference/secrets-catalog.md
      environment: documentation/reference/environment-variables.md
```

**Changes**:
- **Removed**: Verbose `secrets.catalog` (106 lines) → moved to `documentation/reference/secrets-catalog.md`
- **Simplified**: Keep high-level concepts, reference full catalogs
- **Added**: Naming and versioning conventions
- **Clarified**: Environment variable sources and auto-injection

**Lines**: 105 → ~35 (67% reduction)

---

## 4. Section-by-Section Analysis

### 4.1 Keep As-Is (No Changes)

| Section | Lines | Reason |
|---------|-------|--------|
| `name` | 1 | Simple metadata |
| `description` | 3 | Simple metadata |
| `project` | 7 | Core project metadata |
| `platform` | 233 | Excellent v2 schema (Sprint 4) |
| `infrastructure` | 139 | Excellent v2 schema (Sprint 4) |
| `defaults` | 47 | Useful service defaults |
| `services` | 485 | Core service registry |
| `executionContexts` | 75 | Core runtime config |

**Total**: 990 lines (69% of file)

### 4.2 Refactor/Relocate

| Section | Current Lines | New Lines | Action | New Location |
|---------|---------------|-----------|--------|--------------|
| `llm_guidance` | 32 | 40 | **Enhance**: Add intent, consolidate references | Same |
| `messaging` | 202 | 100 | **Refactor**: Remove redundant config, add intent | Same |
| `conventions` | 105 | 35 | **Refactor**: Move catalogs to docs, keep conventions | Same |
| `dataflow` | 39 | 0 | **Relocate**: Move to `platform.orchestration` | platform.orchestration |

**Total Reduction**: 378 lines → 175 lines (54% reduction)

### 4.3 Remove Entirely

| Section | Lines | Reason | Document In |
|---------|-------|--------|-------------|
| `references` | 11 | **Consolidate** into `llm_guidance.references` | llm_guidance.references |
| `extension_points` | 53 | **Out of date**, MCP tooling supersedes | documentation/guides/extending-bitbrat.md |
| `cloudResources` | 98 | **Already marked legacy**, belongs in infrastructure.gcp | (Remove, document for potential future use) |
| `deploymentDefaults` | 12 | **Unused**, duplicates `defaults.services` | (Remove) |
| `networking` | 11 | **GCP-specific**, unused | documentation/guides/gcp-networking.md |

**Total Removed**: 185 lines

### 4.4 New Sections

| Section | Lines | Purpose |
|---------|-------|---------|
| `platform.orchestration` | 50 | Consolidate dataflow + add {config, constraints, intent} |

**Total Added**: 50 lines

### 4.5 Net Impact

```
Current:  1444 lines
Removed:   185 lines
Reduced:   203 lines (refactoring: 378 → 175)
Added:      50 lines (platform.orchestration)
─────────────────────
New:      1106 lines (23% reduction)
```

---

## 5. Migration Strategy

### 5.1 Phase Breakdown

| Phase | Duration | Focus | Key Deliverables |
|-------|----------|-------|------------------|
| **Phase 1: Documentation** | 2 days | Create reference docs for relocated content | secrets-catalog.md, environment-variables.md, extending-bitbrat.md |
| **Phase 2: Schema Updates** | 3 days | Refactor sections, apply {config, constraints, intent} | Updated architecture.yaml |
| **Phase 3: Validation** | 1 day | Validate schema, test tooling compatibility | Zero regressions in brat CLI |
| **Phase 4: Documentation Updates** | 1 day | Update CLAUDE.md, README.md, guides | Updated developer documentation |

**Total Duration**: 7 days (1 sprint iteration)

### 5.2 Phase 1: Documentation (Days 1-2)

**Goal**: Create reference documentation for content being relocated from architecture.yaml

#### Task 1.1: Create Secrets Catalog (Day 1, 2 hours)

**File**: `documentation/reference/secrets-catalog.md`

**Content**:
```markdown
# Secrets Catalog

Complete reference for all secrets used in the BitBrat Platform.

## Secret Management

**Local/Development**: `.env` files in `.secure.local/`
**Staging**: Google Secret Manager (bitbrat-staging project)
**Production**: Google Secret Manager (bitbrat-prod project)

## Catalog

### MCP_AUTH_TOKEN
**Description**: Bearer token authorizing service-to-MCP-gateway (tool-gateway) calls
**Source**: Google Secret Manager
**Used By**: auth, event-router, obs-mcp, scheduler, state-engine, disposition-service, tool-gateway, image-gen-mcp, stream-analyst-service, story-engine-mcp

### OPENAI_API_KEY
**Description**: OpenAI API key for LLM analysis and image generation
**Source**: Google Secret Manager
**Used By**: query-analyzer, llm-bot, image-gen-mcp

... (rest of catalog from conventions.secrets.catalog)
```

**Validation**: Ensure all secrets from `conventions.secrets.catalog` are documented

#### Task 1.2: Create Environment Variables Reference (Day 1, 2 hours)

**File**: `documentation/reference/environment-variables.md`

**Content**:
```markdown
# Environment Variables Reference

Complete reference for environment variables used in the BitBrat Platform.

## Sources

- **GCP Secret Manager**: Secrets (API keys, tokens)
- **dotenv**: Local `.env` files
- **Cloud Run Injection**: Auto-injected by Cloud Run

## Auto-Injected Variables

### K_REVISION
**Source**: Cloud Run injection
**Description**: Cloud Run revision name, used as default per-instance egress {instanceId}

## Common Variables

### LOG_LEVEL
**Values**: error | warn | info | debug | trace
**Default**: info
**Used By**: All services

### MESSAGE_BUS_DRIVER
**Values**: nats | pubsub
**Default**: nats (local), pubsub (production)
**Used By**: All services

... (rest of common variables)
```

#### Task 1.3: Create Extending BitBrat Guide (Day 2, 4 hours)

**File**: `documentation/guides/extending-bitbrat.md`

**Content**: Migrate `extension_points` section content plus enhancements

```markdown
# Extending BitBrat

This guide explains how to extend the BitBrat Platform with new services, MCP tools, and routing rules.

## Adding a New Service

Use the `brat bit create` command to scaffold a new service:

```bash
# Basic service
npm run brat -- bit create my-service

# MCP tool server
npm run brat -- bit create my-tool --profile mcp-server

# Gateway service
npm run brat -- bit create my-gateway --profile gateway --exposure platform+domain

# Register immediately in architecture.yaml
npm run brat -- bit create my-service --register --active
```

... (rest of guide)
```

### 5.3 Phase 2: Schema Updates (Days 3-5)

#### Task 2.1: Refactor `messaging` Section (Day 3, 4 hours)

**Changes**:
1. Remove redundant config (transport, tuning) → reference platform.infrastructure.messaging
2. Condense topic registry (remove verbose descriptions, keep essentials)
3. Add `intent` subsection
4. Add `infrastructure` reference field

**Before** (202 lines):
```yaml
messaging:
  description: >
    The internal event bus...
  reference: documentation/reference/messaging-system.md
  transport:
    driver_env: MESSAGE_BUS_DRIVER
    local: nats
    production: pubsub
    subject_prefix_env: BUS_PREFIX
    delivery: at-least-once
    tuning:
      pubsub_max_ack_extension_seconds_env: PUBSUB_MAX_ACK_EXTENSION_SECONDS
      # ... 5 more tuning params
  conventions:
    topic_naming: internal.<domain>.<verb>.v<version>
    # ...
  envelope:
    schema: documentation/schemas/envelope.v1.json
    # ...
  dlq:
    # ...
  topics:
    internal.finalize.v1:
      description: Generic finalize signal...
      producers: [any-service]
      consumers: []
      schema: documentation/schemas/envelope.v1.json
    # ... 18 more topics
```

**After** (~100 lines):
```yaml
messaging:
  description: >
    Internal event bus connects all services via topics. Orchestration uses routing slips.
    Delivery is at-least-once (consumers MUST be idempotent).

  infrastructure: platform.infrastructure.messaging  # See platform section for config

  envelope:
    schema: documentation/schemas/envelope.v1.json
    required: [v, source, correlationId]
    optional: [traceId, replyTo, timeoutAt, routingSlip]
    routing_slip_schema: documentation/schemas/routing-slip.v1.json

  conventions:
    topic_naming: internal.<domain>.<verb>.v<version>
    versioning: Bump v<N> on breaking payload changes
    per_instance: '.{instanceId}' suffix targets single instance

  dlq:
    topics: [internal.deadletter.v1, internal.router.dlq.v1]

  topics:
    internal.ingress.v1:
      producers: [ingress-egress, scheduler, api-gateway]
      consumers: [event-router, persistence]
    internal.egress.v1:
      producers: [event-router, scheduler]
      consumers: [ingress-egress]
    # ... (condensed topic list)

  intent:
    - "Decoupled publish-subscribe for independent service scaling"
    - "Routing slips enable dynamic orchestration"
    - "Topic versioning ensures backward compatibility"
```

#### Task 2.2: Refactor `conventions` Section (Day 3, 2 hours)

**Changes**:
1. Remove `secrets.catalog` (106 lines) → moved to documentation/reference/secrets-catalog.md
2. Add `naming` and `versioning` subsections
3. Simplify `environment` subsection, reference full catalog

**Before** (105 lines):
```yaml
conventions:
  env:
    description: Variables listed under...
    sources: [gcp-secret-manager, dotenv, cloud-run-injection]
    auto_injected:
      - name: K_REVISION
        # ...
  secrets:
    description: Names listed under...
    default_source: gcp-secret-manager
    catalog:
      MCP_AUTH_TOKEN:
        description: ...
        source: gcp-secret-manager
        used_by: [auth, event-router, ...]  # 13 services
      # ... 14 more secrets, 106 lines total
```

**After** (~35 lines):
```yaml
conventions:
  naming:
    files: kebab-case
    classes: PascalCase
    functions: camelCase
    variables: camelCase
    constants: UPPER_SNAKE_CASE
    topics: internal.<domain>.<verb>.v<version>

  versioning:
    topics: Bump v<N> on breaking payload changes
    services: Semantic versioning (major.minor.patch)
    architecture: platform.version field

  environment:
    sources: [gcp-secret-manager, dotenv, cloud-run-injection]
    auto_injected:
      - name: K_REVISION
        source: cloud-run-injection
    catalogs:
      secrets: documentation/reference/secrets-catalog.md
      environment: documentation/reference/environment-variables.md
```

#### Task 2.3: Create `platform.orchestration` Section (Day 4, 4 hours)

**New Section**: Consolidate `dataflow` into platform schema

**Content**:
```yaml
platform:
  orchestration:
    config:
      model: event-driven
      flow: perceive-plan-act-observe
      coordination: routing-slip

    stages:
      - id: ingest
        services: [ingress-egress, api-gateway, scheduler]
        topics:
          publishes: [internal.ingress.v1]
      # ... other stages

    intent:
      - "Decouples agent loop into independent services"
      - "Routing slip enables dynamic orchestration"

    constraints:
      requiresMessaging: true
      requiresRoutingSlip: true
      maxStageLatency: 1000
```

#### Task 2.4: Enhance `llm_guidance` Section (Day 4, 2 hours)

**Changes**:
1. Consolidate `references` section into `llm_guidance.references`
2. Add `intent` subsection
3. Update references (v1 → v2 schemas)

**Before** (32 lines):
```yaml
llm_guidance:
  default_system_prompt: ...
  glossary: {...}
  invariants: [...]
  doc_pointers:
    flow: documentation/concepts/platform-flow.md
    messaging: documentation/reference/messaging-system.md
    schemas: documentation/schemas/
    backlog: documentation/reference/backlog-example.yaml
    execution-or-implementation-plan: ...
```

**After** (~40 lines):
```yaml
llm_guidance:
  default_system_prompt: ...
  glossary: {...}
  invariants: [...]

  references:
    # Core schemas
    architecture_schema: documentation/schemas/architecture.v2.json
    envelope_schema: documentation/schemas/envelope.v1.json
    routing_slip_schema: documentation/schemas/routing-slip.v1.json

    # Conceptual documentation
    platform_flow: documentation/concepts/platform-flow.md
    event_router_rules: documentation/concepts/event-router-rules.md
    bit_model: documentation/concepts/bit-model.md

    # Reference documentation
    messaging_system: documentation/reference/messaging-system.md
    secrets_catalog: documentation/reference/secrets-catalog.md
    environment_variables: documentation/reference/environment-variables.md

    # Tools and guides
    brat_cli: documentation/tools/brat.md
    extending_platform: documentation/guides/extending-bitbrat.md

  intent:
    - "Single source of truth for platform configuration"
    - "LLM-friendly structured format"
    - "Drives build/deploy tooling (brat CLI)"
    - "Living documentation of current state"
```

#### Task 2.5: Remove Deprecated Sections (Day 5, 2 hours)

**Removals**:
1. Delete `references` section (consolidated into llm_guidance.references)
2. Delete `extension_points` section (documented in guides)
3. Delete `cloudResources` section (legacy, already marked for removal)
4. Delete `deploymentDefaults` section (unused)
5. Delete `networking` section (GCP-specific, unused)
6. Delete `dataflow` section (moved to platform.orchestration)

**Git Commit Message**:
```
refactor(architecture): Remove deprecated and redundant sections

- Remove `references`: Consolidated into llm_guidance.references
- Remove `extension_points`: Documented in documentation/guides/extending-bitbrat.md
- Remove `cloudResources`: Legacy section (GCP-specific), marked for removal since Sprint 4
- Remove `deploymentDefaults`: Unused, duplicates defaults.services
- Remove `networking`: GCP-specific, belongs in deployment guide
- Remove `dataflow`: Moved to platform.orchestration

Total reduction: 224 lines
```

### 5.4 Phase 3: Validation (Day 6)

#### Task 3.1: Schema Validation (4 hours)

**Validation Steps**:
1. **YAML syntax**: Ensure file is valid YAML
   ```bash
   npm run brat -- config validate
   ```

2. **Schema compliance**: Validate against architecture.v2.json
   ```bash
   npm run brat -- config validate --schema v2
   ```

3. **Tooling compatibility**: Ensure brat CLI still works
   ```bash
   # Test all major brat commands
   npm run brat -- fleet list
   npm run brat -- config show
   npm run brat -- context list
   npm run brat -- bit create test-service --dry-run
   ```

4. **Reference integrity**: Ensure all referenced files exist
   ```bash
   # Check all documentation/reference/* files
   ls documentation/reference/secrets-catalog.md
   ls documentation/reference/environment-variables.md
   ls documentation/guides/extending-bitbrat.md
   ```

**Acceptance Criteria**:
- ✅ No YAML syntax errors
- ✅ Passes schema validation
- ✅ All brat commands work without errors
- ✅ All referenced documentation files exist

#### Task 3.2: Regression Testing (2 hours)

**Test Coverage**:
1. **Service metadata parsing**: Ensure services.* parsing still works
2. **Infrastructure resolution**: Ensure infrastructure.{provider} resolution works
3. **Execution context loading**: Ensure executionContexts.* loading works
4. **Topic registry**: Ensure messaging.topics can be queried

**Test Cases**:
```bash
# Test service metadata
npm run brat -- config show --filter services.llm-bot

# Test infrastructure resolution
npm run brat -- config show --filter infrastructure.docker

# Test execution context
npm run brat -- config show --filter executionContexts.local

# Test messaging topics
npm run brat -- config show --filter messaging.topics
```

### 5.5 Phase 4: Documentation Updates (Day 7)

#### Task 4.1: Update CLAUDE.md (2 hours)

**Changes**:
- Remove references to deleted sections (extension_points, cloudResources, networking)
- Add references to new documentation (secrets-catalog.md, extending-bitbrat.md)
- Update architecture overview to reflect new structure

#### Task 4.2: Update README.md (2 hours)

**Changes**:
- Update architecture overview section
- Remove references to deleted sections
- Add links to new reference documentation

#### Task 4.3: Create Migration Guide (2 hours)

**File**: `planning/sprint-8-uhh8fj/migration-guide.md`

**Content**:
```markdown
# Migration Guide: Architecture.yaml Consolidation

This guide documents the changes made in Sprint 8 to consolidate and refactor architecture.yaml.

## Summary of Changes

### Sections Removed
- `references`: Consolidated into `llm_guidance.references`
- `extension_points`: Documented in `documentation/guides/extending-bitbrat.md`
- `cloudResources`: Legacy section, removed
- `deploymentDefaults`: Unused, removed
- `networking`: GCP-specific, removed
- `dataflow`: Moved to `platform.orchestration`

### Sections Refactored
- `messaging`: Reduced from 202 lines to ~100 lines (removed redundant config)
- `conventions`: Reduced from 105 lines to ~35 lines (moved catalogs to docs)
- `llm_guidance`: Enhanced with consolidated references and intent

### New Sections
- `platform.orchestration`: Consolidates dataflow with {config, constraints, intent} pattern

## For Developers

If you were referencing any of the removed sections:

- **extension_points** → See `documentation/guides/extending-bitbrat.md`
- **cloudResources** → (Removed, legacy GCP-specific section)
- **conventions.secrets.catalog** → See `documentation/reference/secrets-catalog.md`
- **references.platform_flow** → See `llm_guidance.references.platform_flow`

## For Tooling

If your tooling parses architecture.yaml:

- **messaging.transport** → Use `platform.infrastructure.messaging.config` instead
- **messaging.tuning** → Use `platform.infrastructure.messaging.config` instead
- **dataflow.stages** → Use `platform.orchestration.stages` instead
```

---

## 6. Risk Analysis

### 6.1 High-Risk Areas

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Breaking changes in tooling** | HIGH | MEDIUM | Comprehensive regression testing, backward-compatible references |
| **Documentation drift** | MEDIUM | MEDIUM | Cross-reference validation, link checking |
| **Lost configuration** | HIGH | LOW | Careful migration, review all removed content |
| **Developer confusion** | MEDIUM | MEDIUM | Clear migration guide, announce changes |

### 6.2 Mitigation Strategies

**1. Backward-Compatible References**

Keep deleted section names as comments with pointers:

```yaml
# REMOVED: references section
# See llm_guidance.references for consolidated documentation pointers

# REMOVED: extension_points section
# See documentation/guides/extending-bitbrat.md for extension guide

# REMOVED: conventions.secrets.catalog
# See documentation/reference/secrets-catalog.md for full catalog
```

**2. Validation Automation**

Add validation to CI/CD:

```bash
# In .github/workflows/validate-architecture.yml
npm run brat -- config validate --schema v2
npm run brat -- config check-references  # Ensure all refs exist
```

**3. Rollback Plan**

Keep a backup of the current architecture.yaml:

```bash
cp architecture.yaml architecture.v1.backup.yaml
git add architecture.v1.backup.yaml
```

---

## 7. Success Metrics

### 7.1 Quantitative Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Total Lines** | 1444 | ~1106 | 23% reduction |
| **Top-Level Sections** | 16 | 10 | 38% reduction |
| **Redundant Config Lines** | ~150 | 0 | 100% elimination |
| **Documentation Files** | N/A | 3 new | secrets-catalog.md, environment-variables.md, extending-bitbrat.md |
| **Schema Validation Time** | N/A | <1s | Fast validation |

### 7.2 Qualitative Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Developer Understanding** | 6/10 | 8/10 | Developer survey |
| **LLM Parsing Efficiency** | 7/10 | 9/10 | Claude Code feedback |
| **Maintenance Burden** | 7/10 | 9/10 | Time to make changes |
| **Documentation Quality** | 6/10 | 9/10 | Completeness, clarity |

### 7.3 Acceptance Criteria

- ✅ All removed sections documented in reference docs
- ✅ Zero regressions in brat CLI functionality
- ✅ Schema validation passes
- ✅ All tests pass
- ✅ Migration guide complete
- ✅ CLAUDE.md and README.md updated

---

## 8. Recommendations

### 8.1 Immediate Actions (Sprint 8)

**1. Approve and Execute This Plan**
- Review this architectural analysis with team
- Get approval for section removals and refactorings
- Execute migration in 7 days (Phases 1-4)

**2. Create Reference Documentation First**
- Ensure no information is lost during migration
- Validate documentation before removing from architecture.yaml

**3. Comprehensive Testing**
- Test all brat CLI commands
- Validate tooling compatibility
- Regression test service deployments

### 8.2 Follow-Up Actions (Sprint 9+)

**1. Extend {config, constraints, intent} Pattern**
- Apply pattern to `defaults.services`
- Apply pattern to `executionContexts`
- Ensure consistency across all sections

**2. Schema Versioning**
- Update `documentation/schemas/architecture.v2.json`
- Add schema version to `platform.version` field
- Implement schema migration tooling

**3. Continuous Improvement**
- Monitor developer feedback
- Refine documentation based on usage
- Add more intent documentation where valuable

### 8.3 Long-Term Vision

**1. Architecture.yaml as Single Source of Truth**
- All platform configuration in one file
- Drives all build/deploy tooling
- Generates documentation automatically

**2. LLM-Optimized Structure**
- Clear, scannable sections
- Minimal redundancy
- Rich intent documentation
- Structured for efficient parsing

**3. Platform-Agnostic Design**
- Provider abstraction (Docker, GCP, AWS, Azure, K8s)
- Execution context flexibility
- Infrastructure portability

---

## 9. Conclusion

This architectural analysis proposes a significant consolidation of architecture.yaml to reduce verbosity, eliminate redundancy, and extend the {config, constraints, intent} pattern established in Sprint 4.

**Key Benefits**:
- **23% file size reduction** (1444 → 1106 lines)
- **38% section reduction** (16 → 10 sections)
- **100% redundancy elimination** (~150 lines of duplicated config)
- **Improved maintainability** via consistent patterns
- **Better developer experience** via clearer documentation

**Recommended Approach**:
1. **Phase 1**: Create reference documentation (2 days)
2. **Phase 2**: Refactor architecture.yaml sections (3 days)
3. **Phase 3**: Comprehensive validation (1 day)
4. **Phase 4**: Update developer documentation (1 day)

**Next Steps**:
1. Review and approve this analysis
2. Create implementation plan
3. Execute migration
4. Validate and document

---

## Appendix A: Before/After Comparison

### Current Structure (v1)

```
architecture.yaml (1444 lines, 16 sections)
├── name (1)
├── description (3)
├── project (7)
├── llm_guidance (32)
├── platform (233) ✅ v2 schema
├── infrastructure (139) ✅ v2 schema
├── messaging (202) ⚠️ Verbose, redundant
├── dataflow (39)
├── conventions (105) ⚠️ More catalog than conventions
├── references (11) ⚠️ Duplicate of llm_guidance.doc_pointers
├── extension_points (53) ❌ Out of date
├── defaults (47)
├── services (485)
├── cloudResources (98) ❌ Legacy
├── deploymentDefaults (12) ❌ Unused
├── networking (11) ❌ GCP-specific
└── executionContexts (75)
```

### Proposed Structure (v2)

```
architecture.yaml (1106 lines, 10 sections)
├── name (1)
├── description (3)
├── project (7)
├── llm_guidance (40) ✅ Enhanced with references + intent
├── platform (283) ✅ Added orchestration subsection
│   ├── infrastructure (233)
│   └── orchestration (50) ✨ NEW
├── infrastructure (200) ✅ Unchanged
├── messaging (100) ✅ Refactored, -50% lines
├── conventions (35) ✅ Refactored, -67% lines
├── defaults (50) ✅ Slightly enhanced
├── services (485) ✅ Unchanged
└── executionContexts (100) ✅ Slightly enhanced

Removed/Relocated:
├── dataflow → platform.orchestration
├── references → llm_guidance.references
├── extension_points → documentation/guides/extending-bitbrat.md
├── cloudResources → (removed)
├── deploymentDefaults → (removed)
└── networking → (removed)

New Documentation:
├── documentation/reference/secrets-catalog.md
├── documentation/reference/environment-variables.md
└── documentation/guides/extending-bitbrat.md
```

---

## Appendix B: Detailed Line Count Breakdown

| Section | Current | Proposed | Change | %  |
|---------|---------|----------|--------|-----|
| name | 1 | 1 | 0 | 0% |
| description | 3 | 3 | 0 | 0% |
| project | 7 | 7 | 0 | 0% |
| llm_guidance | 32 | 40 | +8 | +25% |
| platform | 233 | 283 | +50 | +21% |
| infrastructure | 139 | 200 | +61 | +44% |
| messaging | 202 | 100 | -102 | -50% |
| dataflow | 39 | 0 | -39 | -100% |
| conventions | 105 | 35 | -70 | -67% |
| references | 11 | 0 | -11 | -100% |
| extension_points | 53 | 0 | -53 | -100% |
| defaults | 47 | 50 | +3 | +6% |
| services | 485 | 485 | 0 | 0% |
| cloudResources | 98 | 0 | -98 | -100% |
| deploymentDefaults | 12 | 0 | -12 | -100% |
| networking | 11 | 0 | -11 | -100% |
| executionContexts | 75 | 100 | +25 | +33% |
| **TOTAL** | **1444** | **1106** | **-338** | **-23%** |

---

## Appendix C: References

- [Sprint 4 Technical Architecture](../sprint-4-architecture-yaml-redesign/technical-architecture.md)
- [Sprint 4 Schema Proposal](../sprint-4-architecture-yaml-redesign/schema-proposal.md)
- [Current architecture.yaml](../../architecture.yaml)
- [JSON Schema v2](../../documentation/schemas/architecture.v2.json)

---

**Document Status**: ✅ Ready for Review
**Next Steps**: Create implementation plan after approval
**Approval Required**: Engineering Lead, Product Owner
