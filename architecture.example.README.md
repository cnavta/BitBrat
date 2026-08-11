# architecture.example.yaml - Guide for LLM Agents

## Overview

This is a **simplified, illustrative example** of `architecture.yaml` designed for LLM consumption. It demonstrates the core patterns and intent without the full complexity of a production configuration.

**Size**: 335 lines (vs 1,093 in production)
**Completeness**: ~30% of production (intentionally simplified)
**Purpose**: Teach LLM agents the architectural patterns and conventions

## What This Example Demonstrates

### 1. **{config, constraints, intent} Pattern**

Every major section follows this three-part structure:

```yaml
section_name:
  intent: >
    WHY this section exists and what it accomplishes

  config:
    key1: value1     # WHAT configuration is available
    key2: value2

  constraints:
    rule1: true      # INVARIANTS that must be honored
    rule2: value
```

**Examples in this file**:
- `platform.orchestration` (lines 62-105)
- `messaging` (lines 107-153)
- `conventions` (lines 269-301)

### 2. **llm_guidance Section** (Lines 24-60)

**Critical for LLM agents** - This is the FIRST section an LLM should read:

- **intent**: Why this section exists
- **glossary**: Domain-specific terminology with precise definitions
- **invariants**: Absolute rules that cannot be violated
- **references**: Pointers to detailed documentation

**Key glossary terms**:
- `routing_slip`: How orchestration works
- `bit`: What a service unit is
- `envelope`: Standard message format
- `enrichment`: Pattern for adding analysis

### 3. **Platform Orchestration** (Lines 62-105)

Demonstrates the **event-driven agent loop** decomposition:

```yaml
platform:
  orchestration:
    config:
      model: event-driven
      flow: perceive-plan-act-observe
      coordination: routing-slip

    stages:
      - id: ingest        # Perceive
      - id: route         # Plan
      - id: analyze       # Plan
      - id: react         # Act
      - id: egress        # Observe
      - id: persist       # Observe
```

**Pattern**: Each stage is:
- A message bus topic
- Handled by specific services
- Part of the agent loop

### 4. **Service Profiles** (Lines 155-267)

Shows **4 different Bit profiles**:

| Profile | Category | Exposure | Example | Purpose |
|---------|----------|----------|---------|---------|
| `gateway` | platform | platform-only | ingress-service | HTTP endpoints, webhooks |
| `core` | platform | platform-only | event-router | Pipeline processing |
| `llm` | platform | platform-only | llm-service | LLM integration |
| `mcp-server` | domain | platform+domain | image-generator | Domain tools for LLM |

**Key differences**:
- **platform-only**: Only exposes `bit.*` control plane
- **platform+domain**: Exposes control plane + domain-specific tools

### 5. **Messaging Topics** (Lines 107-153)

Demonstrates the **event bus catalog**:

```yaml
topics:
  internal.ingress.v1:
    producers: [ingress-service, api-gateway]
    consumers: [event-router, persistence-service]
    schema: documentation/schemas/envelope.v1.json
```

**Naming convention**: `internal.<domain>.<verb>.v<version>`

**Key pattern**: Producers publish, consumers subscribe, routing slip advances

## What's Omitted (Compared to Production)

This example **intentionally excludes**:

1. **Infrastructure providers** (docker, gcp, aws, azure implementations)
2. **Execution contexts** (local, staging, prod environment configs)
3. **Full service catalog** (5 services vs 17 in production)
4. **Complete topic catalog** (3 topics vs 20 in production)
5. **Detailed environment variables** (minimal env/secrets)
6. **Advanced features** (secure files, volume mounts, health checks)

## How to Use This Example

### For LLM Agents

**Step 1**: Read `llm_guidance` section first
- Understand glossary terms
- Note invariants (must never be violated)
- Review references for detailed docs

**Step 2**: Understand orchestration model
- Review `platform.orchestration.stages`
- Understand routing slip pattern
- See how services participate

**Step 3**: Study service patterns
- Compare different profiles (gateway, core, llm, mcp-server)
- Note category (platform vs domain)
- Understand mcp.exposure levels

**Step 4**: Learn conventions
- Environment variable resolution order
- Secret management patterns
- Configuration hierarchy

### For Human Developers

**Use this example to**:
1. Understand the overall architecture quickly
2. See the `{config, constraints, intent}` pattern applied
3. Learn how routing slips enable orchestration
4. Understand the Bit model (profiles, categories, exposure)

**Then refer to**:
- Full `architecture.yaml` for production configuration
- `documentation/guides/extending-bitbrat.md` for adding services
- `documentation/reference/topic-catalog.md` for complete topic list

## Validation

You can validate this example against the JSON Schema:

```bash
# Using ajv-cli
npm install -g ajv-cli
ajv validate -s documentation/schemas/architecture.v2.json -d architecture.example.yaml

# Using Node.js with Zod
npm install zod js-yaml
node -e "
  const yaml = require('js-yaml');
  const fs = require('fs');
  const { ArchitectureSchema } = require('./tools/brat/src/config/schema');
  const arch = yaml.load(fs.readFileSync('architecture.example.yaml', 'utf8'));
  const result = ArchitectureSchema.safeParse(arch);
  console.log(result.success ? '✅ Valid' : '❌ Invalid:', result.error);
"
```

## Key Takeaways for LLMs

1. **{config, constraints, intent}** is the universal pattern
2. **llm_guidance** section is your starting point
3. **Routing slips** enable dynamic orchestration without hardcoded workflows
4. **Services are Bits** with profiles, categories, and MCP exposure levels
5. **Messaging topics** follow strict naming: `internal.<domain>.<verb>.v<version>`
6. **Invariants must never be violated** (see llm_guidance.invariants)
7. **architecture.yaml is the canonical source of truth** for all configuration

## See Also

- **Full architecture.yaml**: Complete production configuration
- **documentation/schemas/architecture.v2.json**: JSON Schema for validation
- **documentation/guides/extending-bitbrat.md**: How to add new services
- **documentation/reference/topic-catalog.md**: Complete topic catalog
- **documentation/guides/sprint-8-architecture-migration.md**: Migration guide for Sprint 8 changes
