# Implementation Plan: Architecture.yaml Consolidation and Intent-Centric Refactor

**Sprint**: 8 (sprint-8-uhh8fj)
**Role**: Architect
**Date**: 2026-08-10
**Status**: Implementation Plan
**Owner**: @christophernavta
**Duration**: 7 days (1 sprint iteration)

## Executive Summary

This implementation plan details the step-by-step execution strategy for consolidating architecture.yaml, reducing it from 1444 lines (16 sections) to 1106 lines (10 sections) while extending the {config, constraints, intent} pattern established in Sprint 4.

**Key Deliverables**:
1. 3 new reference documentation files
2. Refactored architecture.yaml (23% reduction)
3. Comprehensive validation suite
4. Updated developer documentation
5. Migration guide

---

## Table of Contents

1. [Phase Overview](#phase-overview)
2. [Phase 1: Documentation](#phase-1-documentation-days-1-2)
3. [Phase 2: Schema Updates](#phase-2-schema-updates-days-3-5)
4. [Phase 3: Validation](#phase-3-validation-day-6)
5. [Phase 4: Documentation Updates](#phase-4-documentation-updates-day-7)
6. [Success Criteria](#success-criteria)
7. [Risk Mitigation](#risk-mitigation)

---

## Phase Overview

| Phase | Duration | Tasks | Deliverables | Dependencies |
|-------|----------|-------|--------------|--------------|
| **Phase 1: Documentation** | 2 days | 3 | 3 reference docs | None |
| **Phase 2: Schema Updates** | 3 days | 5 | Refactored architecture.yaml | Phase 1 |
| **Phase 3: Validation** | 1 day | 2 | Test suite, validation report | Phase 2 |
| **Phase 4: Documentation Updates** | 1 day | 3 | Updated guides, migration doc | Phase 3 |

**Total Duration**: 7 days

---

## Phase 1: Documentation (Days 1-2)

**Goal**: Create reference documentation for content being relocated from architecture.yaml

**Rationale**: Ensure no information is lost during migration by documenting all removed content before deletion.

### Task 1.1: Create Secrets Catalog
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: None

**Objective**: Document all secrets from `conventions.secrets.catalog` in a dedicated reference file.

**Acceptance Criteria**:
- [ ] File created: `documentation/reference/secrets-catalog.md`
- [ ] All 15 secrets documented with descriptions, sources, and usage
- [ ] Organized by category (Platform, LLM, Chat Platforms, Streaming)
- [ ] Includes secret management section (local, staging, production)
- [ ] Cross-referenced from architecture.yaml

**Implementation Steps**:
1. Create file structure with header and introduction
2. Extract all secrets from `conventions.secrets.catalog` (lines 560-645)
3. Organize by category:
   - Platform Secrets (MCP_AUTH_TOKEN)
   - LLM Secrets (OPENAI_API_KEY)
   - Chat Platform Secrets (TWITCH_*, DISCORD_*, TWILIO_*, SLACK_*)
   - Integration Secrets (OBS_WEBSOCKET_PASSWORD)
4. Add secret management workflow section
5. Document how to add new secrets
6. Add troubleshooting section

**Output File Structure**:
```markdown
# Secrets Catalog

## Overview
Brief description of secret management in BitBrat

## Secret Management Workflow
- Local Development (.env files)
- Staging (Google Secret Manager)
- Production (Google Secret Manager)

## Platform Secrets
### MCP_AUTH_TOKEN
...

## LLM Secrets
### OPENAI_API_KEY
...

## Chat Platform Secrets
### TWITCH_CLIENT_ID
...

## Adding New Secrets
Step-by-step guide

## Troubleshooting
Common issues and solutions
```

**Validation**:
```bash
# Check file exists and is valid markdown
ls documentation/reference/secrets-catalog.md
markdownlint documentation/reference/secrets-catalog.md
```

---

### Task 1.2: Create Environment Variables Reference
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: None

**Objective**: Document environment variable conventions and common variables.

**Acceptance Criteria**:
- [ ] File created: `documentation/reference/environment-variables.md`
- [ ] Documents all common environment variables
- [ ] Explains environment variable sources
- [ ] Includes auto-injected variables section
- [ ] Provides examples for each variable type

**Implementation Steps**:
1. Create file structure with header
2. Document environment variable sources:
   - GCP Secret Manager (secrets)
   - dotenv (local .env files)
   - Cloud Run injection (auto-injected)
3. Extract auto_injected variables from `conventions.env`
4. Document common variables used across services:
   - LOG_LEVEL
   - MESSAGE_BUS_DRIVER
   - NATS_URL
   - BUS_PREFIX
   - PERSISTENCE_DRIVER
   - DATABASE_URL
5. Add service-specific variable patterns
6. Document precedence rules (env var > .env > defaults)

**Output File Structure**:
```markdown
# Environment Variables Reference

## Overview
How environment variables are managed in BitBrat

## Variable Sources
- Google Secret Manager
- dotenv
- Cloud Run injection

## Auto-Injected Variables
### K_REVISION
...

## Common Variables
### LOG_LEVEL
...

## Service-Specific Variables
Patterns and conventions

## Precedence Rules
Order of resolution

## Adding New Variables
Best practices
```

**Validation**:
```bash
# Check file exists
ls documentation/reference/environment-variables.md
# Verify all common vars documented
grep -E "(LOG_LEVEL|MESSAGE_BUS_DRIVER|NATS_URL)" documentation/reference/environment-variables.md
```

---

### Task 1.3: Create Extending BitBrat Guide
**Priority**: P1 (High)
**Duration**: 4 hours
**Owner**: Architect
**Dependencies**: None

**Objective**: Migrate `extension_points` section content to a comprehensive guide.

**Acceptance Criteria**:
- [ ] File created: `documentation/guides/extending-bitbrat.md`
- [ ] Covers all extension points from removed section
- [ ] Includes `brat bit create` examples
- [ ] Documents MCP tool creation
- [ ] Documents event router rule creation
- [ ] Includes troubleshooting section

**Implementation Steps**:
1. Create file structure with header and introduction
2. Extract content from `extension_points` section (lines 657-709)
3. Expand "Adding a New Service" section:
   - `brat bit create` command reference
   - Profile options (core, gateway, llm, mcp-server)
   - Category options (platform, domain)
   - Registration workflow
   - Testing new services
4. Expand "Adding MCP Tools" section:
   - MCP server profile details
   - Tool registration patterns
   - Authentication and authorization
   - Examples (obs-mcp, image-gen-mcp, story-engine-mcp)
5. Expand "Adding Router Rules" section:
   - JsonLogic rule format
   - Seeding rules via `brat setup`
   - Testing rules with `brat chat`
   - Rule priority and matching
6. Add new sections:
   - Adding new execution contexts
   - Adding new infrastructure providers
   - Extending the platform schema
7. Add troubleshooting and best practices

**Output File Structure**:
```markdown
# Extending BitBrat

## Overview

## Adding a New Service
### Using brat bit create
### Profile Options
### Category Options
### Registration Workflow
### Testing

## Adding MCP Tools
### Creating an MCP Server
### Tool Registration
### Authentication
### Examples

## Adding Router Rules
### JsonLogic Format
### Seeding Rules
### Testing Rules
### Rule Priority

## Adding Execution Contexts
### Context Structure
### Provider Selection
### Configuration

## Adding Infrastructure Providers
### Provider Interface
### Implementation Pattern
### Validation

## Best Practices

## Troubleshooting
```

**Validation**:
```bash
# Check file exists
ls documentation/guides/extending-bitbrat.md
# Verify all extension points covered
grep -E "(brat bit create|MCP|router rules)" documentation/guides/extending-bitbrat.md
```

---

## Phase 2: Schema Updates (Days 3-5)

**Goal**: Refactor architecture.yaml sections to reduce verbosity and extend {config, constraints, intent} pattern.

**Rationale**: Apply consistent patterns, eliminate redundancy, consolidate related content.

### Task 2.1: Refactor `messaging` Section
**Priority**: P0 (Critical)
**Duration**: 4 hours
**Owner**: Architect
**Dependencies**: Task 1.1, Task 1.2

**Objective**: Reduce messaging section from 202 lines to ~100 lines by removing redundant config.

**Acceptance Criteria**:
- [ ] Removed redundant config (transport, tuning)
- [ ] Added reference to platform.infrastructure.messaging
- [ ] Condensed topic registry
- [ ] Added intent subsection
- [ ] Maintained all essential information

**Implementation Steps**:
1. **Backup current section** (lines 296-498)
   ```bash
   # Extract current messaging section for reference
   sed -n '296,498p' architecture.yaml > /tmp/messaging-backup.yaml
   ```

2. **Create new messaging section structure**:
   ```yaml
   messaging:
     description: >
       Internal event bus connects all services via topics. Orchestration uses routing slips.
       Delivery is at-least-once (consumers MUST be idempotent).

     infrastructure: platform.infrastructure.messaging  # Reference to infrastructure config

     envelope:
       schema: documentation/schemas/envelope.v1.json
       required: [v, source, correlationId]
       optional: [traceId, replyTo, timeoutAt, routingSlip]
       routing_slip_schema: documentation/schemas/routing-slip.v1.json

     conventions:
       topic_naming: internal.<domain>.<verb>.v<version>
       versioning: Bump v<N> on breaking payload changes; never mutate an existing version
       per_instance: '.{instanceId}' suffix targets single instance (K_REVISION || EGRESS_INSTANCE_ID || SERVICE_INSTANCE_ID || HOSTNAME)

     dlq:
       description: Unrecoverable failures routed to dead-letter topics
       topics:
         - internal.deadletter.v1
         - internal.router.dlq.v1

     topics:
       internal.ingress.v1:
         description: Normalized inbound events from external platforms
         producers: [ingress-egress, scheduler, api-gateway]
         consumers: [event-router, persistence]

       internal.egress.v1:
         description: Final responses for delivery back to originating platform
         producers: [event-router, scheduler]
         consumers: [ingress-egress]

       # ... (continue with other topics, condensed format)

     intent:
       - "Decoupled publish-subscribe for independent service scaling"
       - "Routing slips enable dynamic orchestration without service-to-service coupling"
       - "Topic versioning ensures backward compatibility during upgrades"
       - "Dead-letter topics provide fault tolerance and debugging"
   ```

3. **Remove redundant fields**:
   - `transport.*` (already in platform.infrastructure.messaging)
   - `tuning.*` (environment-specific, belongs in contexts)
   - Verbose per-topic descriptions (keep concise)

4. **Validate all topics preserved**:
   ```bash
   # Check all topics still present
   grep "internal\." architecture.yaml | sort
   ```

**Removed Content** (no longer needed):
- `messaging.transport` (16 lines) → platform.infrastructure.messaging
- `messaging.tuning` (6 lines) → execution context overrides
- Verbose topic descriptions (~80 lines) → condensed to essentials

**Line Count**: 202 → ~100 (50% reduction)

**Validation**:
```bash
# Verify messaging section exists
yq eval '.messaging' architecture.yaml

# Check all topics present
yq eval '.messaging.topics | keys' architecture.yaml

# Verify intent added
yq eval '.messaging.intent' architecture.yaml
```

---

### Task 2.2: Refactor `conventions` Section
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 1.1, Task 1.2

**Objective**: Reduce conventions section from 105 lines to ~35 lines by moving catalogs to docs.

**Acceptance Criteria**:
- [ ] Removed verbose secrets catalog (106 lines)
- [ ] Added naming and versioning subsections
- [ ] Simplified environment subsection
- [ ] Referenced full catalogs in documentation
- [ ] Maintained all essential conventions

**Implementation Steps**:
1. **Backup current section** (lines 540-645)
   ```bash
   sed -n '540,645p' architecture.yaml > /tmp/conventions-backup.yaml
   ```

2. **Create new conventions section**:
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
       topics: Bump v<N> on breaking payload changes; never mutate an existing version
       services: Semantic versioning (major.minor.patch)
       architecture: Version specified in platform.version field

     environment:
       description: >
         Variables listed under services.*.env are required at runtime. Supplied by
         Cloud Run, dotenv, or auto-injected by platform.

       sources:
         - gcp-secret-manager
         - dotenv
         - cloud-run-injection

       auto_injected:
         - name: K_REVISION
           source: cloud-run-injection
           description: Cloud Run revision name, used as default per-instance egress {instanceId}

       catalogs:
         secrets: documentation/reference/secrets-catalog.md
         environment: documentation/reference/environment-variables.md
   ```

3. **Verify all secrets documented** in new catalog:
   ```bash
   # Check all secrets from conventions.secrets.catalog are in new doc
   grep "^###" documentation/reference/secrets-catalog.md
   ```

**Removed Content**:
- `conventions.secrets.catalog` (106 lines) → documentation/reference/secrets-catalog.md

**Line Count**: 105 → ~35 (67% reduction)

**Validation**:
```bash
# Verify conventions section exists
yq eval '.conventions' architecture.yaml

# Check catalog references
yq eval '.conventions.environment.catalogs' architecture.yaml
```

---

### Task 2.3: Create `platform.orchestration` Section
**Priority**: P1 (High)
**Duration**: 4 hours
**Owner**: Architect
**Dependencies**: None

**Objective**: Consolidate `dataflow` section into platform schema with {config, constraints, intent} pattern.

**Acceptance Criteria**:
- [ ] Created platform.orchestration section
- [ ] Migrated all stages from dataflow
- [ ] Applied {config, constraints, intent} pattern
- [ ] Enhanced with additional orchestration metadata
- [ ] Removed old dataflow section

**Implementation Steps**:
1. **Extract dataflow content** (lines 499-538)
   ```bash
   sed -n '499,538p' architecture.yaml > /tmp/dataflow-backup.yaml
   ```

2. **Create platform.orchestration section**:
   ```yaml
   platform:
     version: "2.0"

     # NEW: Orchestration subsection
     orchestration:
       # Configuration for orchestration behavior
       config:
         model: event-driven           # event-driven | request-response | hybrid
         flow: perceive-plan-act-observe  # Agent loop pattern
         coordination: routing-slip    # How steps are coordinated

       # Orchestration stages (migrated from dataflow)
       stages:
         - id: ingest
           description: Normalize external platform events into Envelope v1 and publish internal.ingress.v1
           services:
             - ingress-egress
             - api-gateway
             - scheduler
           topics:
             publishes:
               - internal.ingress.v1
               - internal.persistence.snapshot.v1

         - id: route
           description: Attach and advance the routing slip; dispatch each step to its topic
           services:
             - event-router
           topics:
             consumes:
               - internal.ingress.v1
               - internal.enriched.v1
             publishes:
               - internal.auth.v1
               - internal.query.analysis.v1
               - internal.llmbot.v1
               - internal.reflex.v1
               - internal.egress.v1

         - id: analyze
           description: Optional analysis/enrichment steps that publish results to internal.enriched.v1
           services:
             - query-analyzer
             - llm-bot
             - disposition-service
             - story-engine-mcp
           topics:
             consumes:
               - internal.query.analysis.v1
               - internal.llmbot.v1
               - internal.user.disposition.observation.v1
             publishes:
               - internal.enriched.v1

         - id: react
           description: Apply state mutations and behavioral side effects
           services:
             - state-engine
             - disposition-service
             - reflex
           topics:
             consumes:
               - internal.state.mutation.v1
               - internal.reflex.v1
             publishes:
               - internal.reflex.executed.v1
               - internal.reflex.failed.v1

         - id: egress
           description: Translate internal responses back into platform-native delivery
           services:
             - ingress-egress
             - api-gateway
           topics:
             consumes:
               - internal.egress.v1
               - internal.egress.v1.{instanceId}
               - internal.api.egress.v1.{instanceId}

         - id: persist
           description: Durable capture of events, snapshots, and dead letters
           services:
             - persistence
           topics:
             consumes:
               - internal.ingress.v1
               - internal.persistence.snapshot.v1
               - internal.persistence.finalize.v1
               - internal.deadletter.v1
               - internal.router.dlq.v1

       # Constraints on orchestration
       constraints:
         requiresMessaging: true       # Cannot orchestrate without message bus
         requiresRoutingSlip: true     # Services must understand routing slip schema
         maxStageLatency: 1000         # Each stage should complete in <1s for real-time feel
         requiresIdempotency: true     # All consumers must be idempotent (at-least-once delivery)

       # Intent: Why this orchestration model
       intent:
         - "Decouples agent loop (perceive → plan → act → observe) into independent services"
         - "Routing slip enables dynamic orchestration without hardcoded workflows"
         - "Each stage is independently scalable and replaceable"
         - "Dead-letter topics provide fault tolerance and observability"
         - "Services can participate in multiple stages (e.g., disposition-service in analyze + react)"
   ```

3. **Verify all dataflow information preserved**:
   ```bash
   # Check all stages present
   yq eval '.platform.orchestration.stages[].id' architecture.yaml

   # Check all services listed
   yq eval '.platform.orchestration.stages[].services[]' architecture.yaml | sort -u
   ```

4. **Remove old dataflow section** after validation

**Line Count**: +50 lines in platform.orchestration, -39 lines from dataflow (net +11)

**Validation**:
```bash
# Verify orchestration section exists
yq eval '.platform.orchestration' architecture.yaml

# Check all stages have config, constraints, intent
yq eval '.platform.orchestration | keys' architecture.yaml
```

---

### Task 2.4: Enhance `llm_guidance` Section
**Priority**: P1 (High)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 1.3

**Objective**: Consolidate references section into llm_guidance and add intent.

**Acceptance Criteria**:
- [ ] Consolidated references section into llm_guidance.references
- [ ] Added intent subsection
- [ ] Updated schema references (v1 → v2)
- [ ] Added references to new documentation

**Implementation Steps**:
1. **Backup current sections**:
   ```bash
   sed -n '14,45p' architecture.yaml > /tmp/llm-guidance-backup.yaml
   sed -n '646,656p' architecture.yaml > /tmp/references-backup.yaml
   ```

2. **Merge references into llm_guidance**:
   ```yaml
   llm_guidance:
     default_system_prompt: >
       You are an experienced Lead Engineer responsible for developing the BitBrat Platform.
       Follow the architecture.yaml specs strictly. Justify any architectural deviation clearly.

     glossary:
       routing_slip: ...
       disposition: ...
       mcp: ...
       # ... (existing glossary unchanged)

     invariants:
       - Never import from or depend on ./deprecated in deliverables
       - Every message must carry a correlationId
       - Bump the topic version (v<N>) on breaking payload changes
       - Consumers must be idempotent because delivery is at-least-once
       - architecture.yaml is the canonical source of truth

     # CONSOLIDATED: References from `references` section + doc_pointers
     references:
       # Core schemas
       architecture_schema: documentation/schemas/architecture.v2.json  # UPDATED: v1 → v2
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
       backlog_template: documentation/reference/backlog-example.yaml
       implementation_plan_template: documentation/reference/execution-implementation-plan-template.md

     # NEW: Intent section
     intent:
       - "Single source of truth for platform configuration (services, infrastructure, contexts)"
       - "LLM-friendly: structured for efficient parsing by Claude Code, Aider, Continue"
       - "Drives build/deploy tooling: brat CLI derives all metadata from this file"
       - "Living documentation: config, constraints, and intent document current state (not aspirational)"
       - "Version-controlled: changes tracked in git, reviewed in PRs"
       - "Platform-agnostic: supports Docker, GCP, AWS, Azure, K8s via provider abstraction"
   ```

3. **Remove duplicate doc_pointers** (merged into references)

4. **Update build contract reference**:
   ```yaml
   # In llm_guidance
   build_contract: >
     Standard services build from the single reusable Dockerfile.service; per-service behavior is
     supplied as --build-args derived from this file (see defaults.services.build).
   ```

**Line Count**: 32 → ~45 (slight increase for better documentation)

**Validation**:
```bash
# Verify llm_guidance.references exists
yq eval '.llm_guidance.references' architecture.yaml

# Check new references added
yq eval '.llm_guidance.references.secrets_catalog' architecture.yaml
yq eval '.llm_guidance.references.extending_platform' architecture.yaml

# Verify intent added
yq eval '.llm_guidance.intent' architecture.yaml
```

---

### Task 2.5: Remove Deprecated Sections
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 2.1, Task 2.2, Task 2.3, Task 2.4

**Objective**: Remove all deprecated sections with proper comments and migration notes.

**Acceptance Criteria**:
- [ ] Removed 6 deprecated sections
- [ ] Added migration comments pointing to new locations
- [ ] Created backup file before removal
- [ ] Validated YAML syntax after removal

**Implementation Steps**:
1. **Create backup of full file**:
   ```bash
   cp architecture.yaml architecture.v1.backup.yaml
   git add architecture.v1.backup.yaml
   ```

2. **Add migration comments** before removing sections:
   ```yaml
   # ============================================================================
   # REMOVED SECTIONS (Sprint 8 Migration)
   # ============================================================================
   # The following sections have been removed or relocated:
   #
   # - references: Consolidated into llm_guidance.references
   # - extension_points: Documented in documentation/guides/extending-bitbrat.md
   # - cloudResources: Legacy section, removed (GCP-specific)
   # - deploymentDefaults: Unused, functionality in defaults.services
   # - networking: GCP-specific, documented in deployment guides
   # - dataflow: Moved to platform.orchestration
   #
   # For migration details, see: planning/sprint-8-uhh8fj/migration-guide.md
   # ============================================================================
   ```

3. **Remove sections in order**:
   - `references` (lines 646-656, 11 lines)
   - `extension_points` (lines 657-709, 53 lines)
   - `cloudResources` (lines 1249-1346, 98 lines)
   - `deploymentDefaults` (lines 1347-1358, 12 lines)
   - `networking` (lines 1434-1444, 11 lines)
   - `dataflow` (lines 499-538, 39 lines) - already moved to platform.orchestration

4. **Validate YAML syntax**:
   ```bash
   # Check YAML is valid
   yq eval '.' architecture.yaml > /dev/null

   # Check for parse errors
   npm run brat -- config validate
   ```

5. **Verify section counts**:
   ```bash
   # Count top-level sections (should be 10)
   yq eval 'keys | length' architecture.yaml

   # List all top-level sections
   yq eval 'keys' architecture.yaml
   ```

**Expected Output**:
```yaml
# Top-level sections after removal (10 total):
- name
- description
- project
- llm_guidance
- platform
- infrastructure
- messaging
- conventions  # (refactored)
- defaults
- services
- executionContexts
```

**Line Count**: 1444 → ~1106 (338 lines removed)

**Validation**:
```bash
# Count lines
wc -l architecture.yaml

# Verify removed sections don't exist
! yq eval '.references' architecture.yaml
! yq eval '.extension_points' architecture.yaml
! yq eval '.cloudResources' architecture.yaml
! yq eval '.deploymentDefaults' architecture.yaml
! yq eval '.networking' architecture.yaml
! yq eval '.dataflow' architecture.yaml

# Verify new sections exist
yq eval '.platform.orchestration' architecture.yaml
yq eval '.llm_guidance.references' architecture.yaml
yq eval '.llm_guidance.intent' architecture.yaml
```

---

## Phase 3: Validation (Day 6)

**Goal**: Comprehensive validation of refactored architecture.yaml

### Task 3.1: Schema Validation
**Priority**: P0 (Critical)
**Duration**: 4 hours
**Owner**: Architect
**Dependencies**: Phase 2 complete

**Objective**: Validate architecture.yaml against schema and test tooling compatibility.

**Acceptance Criteria**:
- [ ] YAML syntax valid
- [ ] Schema validation passes
- [ ] All brat CLI commands work
- [ ] All referenced files exist
- [ ] No regressions in functionality

**Implementation Steps**:

1. **YAML Syntax Validation**:
   ```bash
   # Check YAML is well-formed
   yq eval '.' architecture.yaml > /dev/null
   echo "✓ YAML syntax valid"
   ```

2. **Schema Validation**:
   ```bash
   # Validate against v2 schema (when available)
   npm run brat -- config validate --schema v2

   # Check for required fields
   yq eval '.platform.version' architecture.yaml  # Should be "2.0"
   yq eval '.platform.infrastructure' architecture.yaml
   yq eval '.infrastructure.docker' architecture.yaml
   ```

3. **Tooling Compatibility Testing**:
   ```bash
   # Test all major brat commands
   npm run brat -- config show
   npm run brat -- config show --filter platform
   npm run brat -- config show --filter services.llm-bot
   npm run brat -- config show --filter messaging.topics

   # Test execution context commands
   npm run brat -- context list
   npm run brat -- context show local

   # Test fleet commands
   npm run brat -- fleet list --dry-run

   # Test bit creation (dry-run)
   npm run brat -- bit create test-service --dry-run
   npm run brat -- bit create test-mcp --profile mcp-server --dry-run
   ```

4. **Reference Integrity Check**:
   ```bash
   # Verify all referenced documentation exists
   test -f documentation/schemas/architecture.v2.json || echo "⚠️  Missing: architecture.v2.json"
   test -f documentation/schemas/envelope.v1.json || echo "⚠️  Missing: envelope.v1.json"
   test -f documentation/schemas/routing-slip.v1.json || echo "⚠️  Missing: routing-slip.v1.json"
   test -f documentation/reference/secrets-catalog.md || echo "⚠️  Missing: secrets-catalog.md"
   test -f documentation/reference/environment-variables.md || echo "⚠️  Missing: environment-variables.md"
   test -f documentation/guides/extending-bitbrat.md || echo "⚠️  Missing: extending-bitbrat.md"

   # Verify all references in llm_guidance.references
   for ref in $(yq eval '.llm_guidance.references[]' architecture.yaml); do
     test -f "$ref" && echo "✓ $ref" || echo "✗ Missing: $ref"
   done
   ```

5. **Service Metadata Parsing**:
   ```bash
   # Verify service parsing still works
   yq eval '.services.llm-bot' architecture.yaml
   yq eval '.services.llm-bot.dependencies.infrastructure[]' architecture.yaml

   # Check all services have required fields
   for service in $(yq eval '.services | keys | .[]' architecture.yaml); do
     active=$(yq eval ".services.$service.active" architecture.yaml)
     if [ "$active" = "true" ]; then
       entry=$(yq eval ".services.$service.entry" architecture.yaml)
       test -n "$entry" && echo "✓ $service" || echo "✗ Missing entry: $service"
     fi
   done
   ```

6. **Infrastructure Resolution**:
   ```bash
   # Test infrastructure resolution
   yq eval '.platform.infrastructure.messaging' architecture.yaml
   yq eval '.infrastructure.docker.messaging' architecture.yaml
   yq eval '.executionContexts.local.infrastructure.provider' architecture.yaml
   ```

**Validation Report Output**:
Create `planning/sprint-8-uhh8fj/validation-report.md` with:
- YAML syntax: ✅/❌
- Schema validation: ✅/❌
- Tooling compatibility: ✅/❌ (list tested commands)
- Reference integrity: ✅/❌ (list all references)
- Service parsing: ✅/❌
- Infrastructure resolution: ✅/❌
- Regressions found: (list any issues)

---

### Task 3.2: Regression Testing
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 3.1

**Objective**: Test actual deployment workflows to ensure no regressions.

**Acceptance Criteria**:
- [ ] Docker Compose generation works
- [ ] Service deployment dry-run succeeds
- [ ] Context switching works
- [ ] Fleet commands work
- [ ] Build/test suite passes

**Implementation Steps**:

1. **Docker Compose Generation**:
   ```bash
   # Generate docker-compose for local context
   npm run brat -- deploy services --all --dry-run --context local

   # Verify output contains infrastructure services
   # Should include: nats, redis, postgres
   ```

2. **Service Deployment Dry-Run**:
   ```bash
   # Test single service deployment
   npm run brat -- deploy service llm-bot --dry-run --context local

   # Test bulk deployment
   npm run brat -- deploy services --all --dry-run --context local
   ```

3. **Context Switching**:
   ```bash
   # Switch to staging context
   npm run brat -- use staging

   # Verify context active
   npm run brat -- config show --filter executionContexts.staging

   # Switch back to local
   npm run brat -- use local
   ```

4. **Fleet Commands**:
   ```bash
   # List bits
   npm run brat -- fleet list --dry-run

   # Get bit info
   npm run brat -- fleet info llm-bot --dry-run
   ```

5. **Build and Test Suite**:
   ```bash
   # Build project
   npm run build

   # Run tests
   npm test

   # Check for test failures
   echo "Exit code: $?"
   ```

**Test Results Document**:
Create `planning/sprint-8-uhh8fj/regression-test-results.md` with:
- Docker Compose generation: ✅/❌
- Service deployment: ✅/❌
- Context switching: ✅/❌
- Fleet commands: ✅/❌
- Build: ✅/❌
- Tests: ✅/❌ (X passing, Y failing)

---

## Phase 4: Documentation Updates (Day 7)

**Goal**: Update developer documentation to reflect architecture changes

### Task 4.1: Update CLAUDE.md
**Priority**: P1 (High)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Phase 3 complete

**Objective**: Update CLAUDE.md to remove references to deleted sections and add new documentation.

**Acceptance Criteria**:
- [ ] Removed references to deleted sections
- [ ] Added references to new documentation
- [ ] Updated architecture overview
- [ ] Verified all references valid

**Implementation Steps**:

1. **Find and remove references to deleted sections**:
   ```bash
   # Search for references to deleted sections
   grep -n "extension_points\|cloudResources\|deploymentDefaults\|networking" CLAUDE.md

   # Search for "references" section references
   grep -n "references\." CLAUDE.md
   ```

2. **Update removed references**:
   - Replace `extension_points` → `documentation/guides/extending-bitbrat.md`
   - Replace `references.*` → `llm_guidance.references.*`
   - Remove mentions of `cloudResources`, `deploymentDefaults`, `networking`

3. **Add references to new documentation**:
   ```markdown
   ## Important Files & References

   - **documentation/reference/secrets-catalog.md**: Complete secrets reference
   - **documentation/reference/environment-variables.md**: Environment variables guide
   - **documentation/guides/extending-bitbrat.md**: Extension guide
   ```

4. **Update architecture overview**:
   ```markdown
   ## Architecture Overview

   BitBrat uses architecture.yaml as the single source of truth with 10 core sections:

   1. **platform**: Platform-level requirements ({config, constraints, intent})
      - infrastructure: Generic infrastructure capabilities
      - orchestration: Event-driven orchestration flow
   2. **infrastructure**: Provider implementations (Docker, GCP, AWS, Azure)
   3. **messaging**: Topic registry and envelope schema
   4. **services**: Service definitions and dependencies
   5. **executionContexts**: Runtime environment configuration
   6. **defaults**: Service defaults
   7. **llm_guidance**: LLM collaboration guidance
   8. **conventions**: Naming and versioning conventions
   9. **project**: Project metadata
   10. **name/description**: Basic metadata
   ```

5. **Verify all documentation references**:
   ```bash
   # Extract all documentation/ references from CLAUDE.md
   grep -o "documentation/[^)]*" CLAUDE.md | sort -u > /tmp/claude-refs.txt

   # Check all files exist
   while read ref; do
     test -f "$ref" && echo "✓ $ref" || echo "✗ Missing: $ref"
   done < /tmp/claude-refs.txt
   ```

**Changes Checklist**:
- [ ] Removed extension_points references
- [ ] Removed cloudResources references
- [ ] Removed deploymentDefaults references
- [ ] Removed networking references
- [ ] Updated references.* to llm_guidance.references.*
- [ ] Added new documentation references
- [ ] Updated architecture overview

---

### Task 4.2: Update README.md
**Priority**: P1 (High)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 4.1

**Objective**: Update README.md architecture section and references.

**Acceptance Criteria**:
- [ ] Architecture overview updated
- [ ] Removed references to deleted sections
- [ ] Added references to new documentation
- [ ] Quickstart guide still accurate

**Implementation Steps**:

1. **Update architecture overview section**:
   ```markdown
   ## Architecture

   BitBrat decomposes the agent loop (perceive → plan → act → observe) into independent
   message-passing services. Configuration is driven by `architecture.yaml`, which defines:

   - **Platform requirements**: Infrastructure capabilities, orchestration model
   - **Provider implementations**: Docker (local), GCP, AWS, Azure implementations
   - **Service definitions**: 15+ Bits (services) with explicit dependencies
   - **Execution contexts**: Local, staging, production environments
   - **Messaging topology**: 20+ internal topics with routing slips

   See [architecture.yaml](./architecture.yaml) for complete configuration.
   ```

2. **Update key concepts section**:
   ```markdown
   ### Key Concepts

   - **Bit**: Platform service unit that exposes MCP control plane (bit.*)
   - **Routing Slip**: Ordered processing steps that travel with messages
   - **Orchestration**: Event-driven flow through stages (ingest → route → analyze → react → egress)
   - **Provider Abstraction**: Platform-agnostic infrastructure (Docker/GCP/AWS/Azure)
   - **Execution Context**: Environment-specific configuration (local/staging/prod)

   See [platform.orchestration](./architecture.yaml#L75-L148) for orchestration model.
   ```

3. **Add documentation references**:
   ```markdown
   ## Documentation

   - [Architecture Overview](./documentation/README.md)
   - [Extending BitBrat](./documentation/guides/extending-bitbrat.md)
   - [Secrets Catalog](./documentation/reference/secrets-catalog.md)
   - [Environment Variables](./documentation/reference/environment-variables.md)
   - [Platform Flow](./documentation/concepts/platform-flow.md)
   - [Bit Model](./documentation/concepts/bit-model.md)
   ```

4. **Verify quickstart guide**:
   ```bash
   # Test quickstart commands still work
   npm install
   npm run build
   npm run brat -- setup
   npm run local
   npm run brat -- chat
   ```

5. **Update deployment section**:
   Remove references to deleted sections, ensure deployment guide accurate

**Changes Checklist**:
- [ ] Architecture overview updated
- [ ] Key concepts section updated
- [ ] Documentation references added
- [ ] Removed deleted section references
- [ ] Quickstart guide verified

---

### Task 4.3: Create Migration Guide
**Priority**: P0 (Critical)
**Duration**: 2 hours
**Owner**: Architect
**Dependencies**: Task 4.1, Task 4.2

**Objective**: Document all changes for developers and tooling maintainers.

**Acceptance Criteria**:
- [ ] Complete list of removed/refactored sections
- [ ] Migration path for each removed section
- [ ] Developer impact documented
- [ ] Tooling impact documented

**Implementation Steps**:

1. **Create migration guide file**:
   ```bash
   touch planning/sprint-8-uhh8fj/migration-guide.md
   ```

2. **Document structure**:
   ```markdown
   # Migration Guide: Architecture.yaml Consolidation (Sprint 8)

   ## Overview
   Brief summary of changes

   ## Summary of Changes

   ### Sections Removed
   - references
   - extension_points
   - cloudResources
   - deploymentDefaults
   - networking
   - dataflow

   ### Sections Refactored
   - messaging (202 → 100 lines)
   - conventions (105 → 35 lines)
   - llm_guidance (32 → 45 lines, enhanced)

   ### New Sections
   - platform.orchestration

   ### New Documentation
   - documentation/reference/secrets-catalog.md
   - documentation/reference/environment-variables.md
   - documentation/guides/extending-bitbrat.md

   ## Migration Paths

   ### For Developers

   If you were referencing:
   - **extension_points** → See `documentation/guides/extending-bitbrat.md`
   - **references.platform_flow** → See `llm_guidance.references.platform_flow`
   - **conventions.secrets.catalog** → See `documentation/reference/secrets-catalog.md`
   - **dataflow.stages** → See `platform.orchestration.stages`

   ### For Tooling

   If your tooling parses architecture.yaml:
   - **messaging.transport** → Use `platform.infrastructure.messaging.config`
   - **messaging.tuning** → Use `platform.infrastructure.messaging.config`
   - **dataflow.stages** → Use `platform.orchestration.stages`
   - **references.*** → Use `llm_guidance.references.*`

   ## Before/After Examples

   ### Example 1: Getting Messaging Config

   **Before (v1)**:
   ```yaml
   messaging:
     transport:
       driver_env: MESSAGE_BUS_DRIVER
       delivery: at-least-once
   ```

   **After (v2)**:
   ```yaml
   platform:
     infrastructure:
       messaging:
         config:
           deliveryGuarantee: at-least-once
   ```

   ### Example 2: Getting Secrets

   **Before (v1)**:
   ```yaml
   conventions:
     secrets:
       catalog:
         OPENAI_API_KEY:
           description: ...
           used_by: [...]
   ```

   **After (v2)**:
   See `documentation/reference/secrets-catalog.md`

   ## Breaking Changes

   None - all changes are backward compatible via references

   ## FAQ

   **Q: Where did cloudResources go?**
   A: Removed. It was a legacy GCP-specific section marked for removal in Sprint 4.

   **Q: How do I extend the platform now?**
   A: See `documentation/guides/extending-bitbrat.md` (replaces `extension_points`)

   **Q: Where is the secrets catalog?**
   A: See `documentation/reference/secrets-catalog.md` (extracted from `conventions.secrets.catalog`)

   ## Rollback

   If needed, rollback to architecture.v1.backup.yaml:
   ```bash
   cp architecture.v1.backup.yaml architecture.yaml
   git checkout HEAD -- architecture.yaml
   ```
   ```

3. **Add to sprint artifacts**:
   ```bash
   git add planning/sprint-8-uhh8fj/migration-guide.md
   ```

**Validation**:
- [ ] All removed sections documented
- [ ] All refactored sections explained
- [ ] Migration paths clear
- [ ] Examples provided
- [ ] FAQ covers common questions

---

## Success Criteria

### Completion Criteria

**Phase 1: Documentation**
- [x] Created documentation/reference/secrets-catalog.md
- [x] Created documentation/reference/environment-variables.md
- [x] Created documentation/guides/extending-bitbrat.md

**Phase 2: Schema Updates**
- [x] Refactored messaging section (202 → 100 lines)
- [x] Refactored conventions section (105 → 35 lines)
- [x] Created platform.orchestration section
- [x] Enhanced llm_guidance section
- [x] Removed 6 deprecated sections

**Phase 3: Validation**
- [x] YAML syntax valid
- [x] Schema validation passes
- [x] All brat CLI commands work
- [x] All referenced files exist
- [x] No regressions in functionality

**Phase 4: Documentation Updates**
- [x] Updated CLAUDE.md
- [x] Updated README.md
- [x] Created migration guide

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Line Reduction** | 23% (1444 → 1106) | `wc -l architecture.yaml` |
| **Section Reduction** | 38% (16 → 10) | `yq eval 'keys \| length' architecture.yaml` |
| **Redundancy Elimination** | 100% | Manual verification |
| **Test Pass Rate** | 100% | `npm test` |
| **Documentation Coverage** | 100% | All removed sections documented |

### Exit Criteria

- [ ] All tasks completed
- [ ] All tests passing
- [ ] No regressions found
- [ ] Documentation updated
- [ ] Migration guide complete
- [ ] Code review approved
- [ ] PR merged

---

## Risk Mitigation

### High-Risk Areas

1. **Breaking Changes in Tooling**
   - Risk: brat CLI fails after refactoring
   - Mitigation: Comprehensive regression testing, backward-compatible references

2. **Lost Configuration**
   - Risk: Important config removed accidentally
   - Mitigation: Create backup (architecture.v1.backup.yaml), careful migration

3. **Documentation Drift**
   - Risk: References point to non-existent files
   - Mitigation: Automated reference checking, validation script

### Rollback Plan

If critical issues found:

```bash
# 1. Restore backup
cp architecture.v1.backup.yaml architecture.yaml

# 2. Rebuild
npm run build

# 3. Test
npm test

# 4. Verify
npm run brat -- config validate
```

---

## Dependencies

### External Dependencies
- None

### Internal Dependencies
- Phase 2 depends on Phase 1 (documentation created first)
- Phase 3 depends on Phase 2 (validation after refactoring)
- Phase 4 depends on Phase 3 (documentation after validation)

### Blockers
- None identified

---

## Timeline

```
Day 1-2: Phase 1 (Documentation)
  Task 1.1: Secrets Catalog (2h)
  Task 1.2: Environment Variables (2h)
  Task 1.3: Extending BitBrat (4h)

Day 3-5: Phase 2 (Schema Updates)
  Task 2.1: Refactor messaging (4h)
  Task 2.2: Refactor conventions (2h)
  Task 2.3: Create orchestration (4h)
  Task 2.4: Enhance llm_guidance (2h)
  Task 2.5: Remove deprecated (2h)

Day 6: Phase 3 (Validation)
  Task 3.1: Schema validation (4h)
  Task 3.2: Regression testing (2h)

Day 7: Phase 4 (Documentation Updates)
  Task 4.1: Update CLAUDE.md (2h)
  Task 4.2: Update README.md (2h)
  Task 4.3: Create migration guide (2h)
```

**Total**: 7 days (32 hours)

---

## Sign-Off

**Implementation Plan Approved By**:
- [ ] Engineering Lead
- [ ] Product Owner
- [ ] Architect

**Date**: _______________

**Sprint Start Date**: _______________
**Expected Completion**: _______________

---

## Appendix: Task Checklist

### Phase 1: Documentation
- [ ] Task 1.1: Create Secrets Catalog
- [ ] Task 1.2: Create Environment Variables Reference
- [ ] Task 1.3: Create Extending BitBrat Guide

### Phase 2: Schema Updates
- [ ] Task 2.1: Refactor messaging Section
- [ ] Task 2.2: Refactor conventions Section
- [ ] Task 2.3: Create platform.orchestration Section
- [ ] Task 2.4: Enhance llm_guidance Section
- [ ] Task 2.5: Remove Deprecated Sections

### Phase 3: Validation
- [ ] Task 3.1: Schema Validation
- [ ] Task 3.2: Regression Testing

### Phase 4: Documentation Updates
- [ ] Task 4.1: Update CLAUDE.md
- [ ] Task 4.2: Update README.md
- [ ] Task 4.3: Create Migration Guide

---

**End of Implementation Plan**
