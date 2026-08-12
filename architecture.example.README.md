# architecture.yaml v2 Format - Example and Guide

## What is architecture.yaml v2?

**architecture.yaml v2** is a structured, schema-validated configuration format for documenting software systems in a way that both humans and LLM coding agents can understand.

**It works for ANY system architecture:**
- REST APIs, GraphQL servers, gRPC services
- Event-driven platforms, message queues, pub/sub systems
- Batch processors, ETL pipelines, data workflows
- Serverless functions, microservices, monoliths
- ML training pipelines, inference services
- Static sites, SPAs, mobile backends

**Size**: 476 lines (example) vs unlimited (your system)
**Completeness**: Intentionally simplified to demonstrate format patterns
**Purpose**: Teach the format structure, not prescribe implementation details

## Why Use This Format?

### Problem 1: LLM Coding Agents Need Context

When Claude Code, Cursor, Aider, or GitHub Copilot work on your codebase, they need to understand:
- What type of system is this? (REST API? Event-driven? Batch processor?)
- What are the critical invariants? (Never log PII, always use transactions)
- What's the domain-specific terminology? (What's a "merchant"? "order_state_machine"?)
- Where are the docs? (Architecture diagrams, API conventions, security model)

**Solution**: The `llm_guidance` section provides a structured orientation for coding agents.

### Problem 2: Multi-Environment Configuration is Hard

Your system runs in multiple environments (local, staging, production), each with different:
- Database hosts, queue URLs, cache endpoints
- Feature flags, rate limits, log levels
- Secrets management (local .env vs AWS Secrets Manager vs GCP Secret Manager)

**Solution**: The `executionContexts` section defines environment-specific overrides with hierarchical resolution.

### Problem 3: Documentation Rots

Traditional docs (Confluence, Notion, Google Docs) drift from reality because they're disconnected from code.

**Solution**: architecture.yaml is **code-adjacent** (version controlled, CI-validated, schema-enforced).

### Problem 4: Configuration Sprawl

Configuration lives in 15 different places:
- `.env` files, `config.json`, `secrets.yaml`, `docker-compose.yml`
- Kubernetes manifests, Terraform variables, CloudFormation parameters
- Hard-coded constants, environment variables, CLI flags

**Solution**: architecture.yaml is the **single source of truth** for system configuration.

## Key Format Features

### 1. {config, constraints, intent} Pattern

Every major section follows this three-part structure:

```yaml
section_name:
  config:
    # WHAT: Concrete configuration values
    style: microservices
    api_paradigm: rest

  constraints:
    # MUST: Invariants that cannot be violated
    stateless_apis: true
    max_api_latency_p95: 500

  intent:
    # WHY: Architectural rationale
    - "APIs are stateless for horizontal scaling"
    - "Cron jobs use leader election to prevent duplicates"
```

**Why?** Separates **what** you're doing from **why** you're doing it. LLMs understand intent, not just config.

### 2. llm_guidance Section (Universal)

**Critical for LLM agents** - This is the FIRST section an LLM should read:

```yaml
llm_guidance:
  intent: >
    Explain why this section exists and how LLMs should use it

  default_system_prompt: >
    Instructions for LLM when working on this codebase

  glossary:
    domain_term: Precise definition with examples

  invariants:
    - Absolute rules that cannot be violated

  references:
    architecture: path/to/architecture-docs.md
    api_conventions: path/to/api-guide.md
```

**This works for ANY domain:** e-commerce, fintech, healthcare, gaming, SaaS, etc.

### 3. services Section (Flexible Schema)

Define ANY service type with a flexible schema:

```yaml
services:
  # REST API
  merchant-api:
    type: api
    language: typescript
    port: 8080
    routes: [...]

  # Background Worker
  email-worker:
    type: worker
    queue: email-jobs
    concurrency: 10

  # Cron Job
  daily-reports:
    type: cron
    schedule: "0 2 * * *"
    timeout: 3600

  # Serverless Function
  payment-webhook:
    type: function
    trigger: http
    memory: 512

  # Static Site
  merchant-dashboard:
    type: static
    framework: react
    cdn: cloudflare
```

**The format is extensible:** Add your own service types, properties, metadata.

### 4. Multi-Environment Support

Define environments with different configurations:

```yaml
executionContexts:
  local:
    deployment:
      type: docker-compose
    runtime:
      database:
        host: localhost
        database: myapp_dev
    env_overrides:
      LOG_LEVEL: debug

  production:
    deployment:
      type: ecs  # or kubernetes, cloud-run, etc.
    runtime:
      database:
        host: prod-db.aws.com
        database: myapp_prod
    env_overrides:
      LOG_LEVEL: warn
```

**Supports any deployment model:** Docker, Kubernetes, ECS, Cloud Run, VMs, bare metal.

### 5. Schema Validation

Validate at **two layers**:

1. **Runtime (Zod)**: Fail-fast on invalid config when services start
2. **CI/CD (JSON Schema)**: Pre-deployment validation before merge

Both validation mechanisms work with architecture.yaml v2.

### 6. Hierarchical Configuration

Configuration resolves in priority order:

1. Runtime environment variable (`$DATABASE_URL`)
2. Execution context override (`executionContexts.production.env_overrides`)
3. Service definition (`services.merchant-api.env`)
4. Defaults (`defaults.services.env`)

**This pattern works for any config management strategy.**

## What This Example Demonstrates

### System Types Shown

| Type | Example | Communication | Use Case |
|------|---------|---------------|----------|
| **REST API** | merchant-api | HTTP/JSON | Public-facing API for merchants |
| **Background Worker** | email-worker | Message queue | Async email sending |
| **Cron Job** | daily-reports | Scheduled | Daily batch reports |
| **Serverless Function** | payment-webhook | HTTP trigger | Event-driven webhook |
| **Static Site** | merchant-dashboard | CDN | React SPA |

### Communication Patterns Shown

| Pattern | Services | When to Use |
|---------|----------|-------------|
| **REST API** | merchant-api, customer-api | Synchronous request-response |
| **Message Queue** | email-worker, webhook-worker | Async job processing |
| **Webhooks** | webhook-api | Event delivery to external systems |

### Data Stores Shown

| Type | Example | Purpose |
|------|---------|---------|
| **PostgreSQL (Primary)** | postgres-primary | Transactional writes |
| **PostgreSQL (Replica)** | postgres-replica | Analytics reads |
| **Redis (Cluster)** | redis-cache | Session store, caching |
| **S3** | s3-assets | Object storage |

## What's Intentionally Omitted

To keep the example focused on **format**, not **implementation**, the following are simplified or omitted:

1. **Provider-specific details**: Infrastructure code (Terraform, CloudFormation)
2. **Advanced features**: Circuit breakers, retries, timeouts, health checks
3. **Observability**: Metrics, traces, logs, alerts (can be added in your implementation)
4. **Security details**: IAM roles, network policies, TLS configs (documented at high level)
5. **Complete service catalog**: Shows 5 services; your system may have dozens

**The format supports all of these** - this example just focuses on core patterns.

## How to Use This Format

### For LLM Coding Agents

**Step 1**: Read `llm_guidance` section first
- Understand domain glossary (e.g., "merchant", "order_state_machine")
- Note invariants (e.g., "never log PII", "use transactions")
- Review documentation links (architecture, API conventions, security)

**Step 2**: Understand system architecture
- Review `system.architecture.config` (microservices? monolith? serverless?)
- Review `system.architecture.components` (how services are grouped)
- Note constraints (API latency limits, job timeouts, migration strategy)

**Step 3**: Study service patterns
- Compare different service types (api, worker, cron, function, static)
- Understand communication patterns (REST API, message queue, webhooks)
- Note environment-specific overrides (local vs staging vs production)

**Step 4**: Learn configuration conventions
- Understand hierarchical resolution (env var > context > service > defaults)
- Note secret management per environment (local .env vs cloud secrets manager)
- Review validation strategy (Zod at runtime, JSON Schema in CI/CD)

### For Human Developers

**Use this format to:**

1. **Onboard faster**: Understand the entire system architecture in one file
2. **Avoid misconfiguration**: Schema validation prevents invalid configs
3. **Manage complexity**: Multi-environment support without config sprawl
4. **Document intent**: {config, constraints, intent} pattern captures "why"
5. **Orient LLM tools**: Accelerate Claude Code, Cursor, GitHub Copilot

**Adoption strategies:**

- **Start small**: Begin with `llm_guidance` and `services` sections only
- **Grow iteratively**: Add `executionContexts`, `datastores`, `communication` as needed
- **Validate early**: Set up JSON Schema validation in CI/CD from day one
- **Keep updated**: Treat architecture.yaml like code (version control, code review)

## Validation

### Portable Validation Files

To use architecture.yaml v2 validation in your own project, copy these files:

**Minimal setup** (JSON Schema only):
```
documentation/schemas/architecture.v2.json   # JSON Schema definition
```

**Full setup** (TypeScript with Zod):
```
tools/brat/src/config/schema.ts              # Zod schema (14KB)
tools/brat/src/config/types.ts               # TypeScript types
tools/brat/src/config/loader.ts              # YAML loader (js-yaml)
documentation/schemas/architecture.v2.json   # JSON Schema (external tools)
```

**Dependencies**:
```json
{
  "zod": "^3.22.0",           // Runtime validation
  "js-yaml": "^4.1.0",        // YAML parsing
  "ajv": "^8.12.0"            // JSON Schema validation (optional)
}
```

### Validation Examples

**JSON Schema (external tools)**:
```bash
npm install -g ajv-cli
ajv validate -s architecture.v2.json -d architecture.yaml
```

**Zod (runtime)**:
```typescript
import { ArchitectureSchema } from './schema';
import yaml from 'js-yaml';
import fs from 'fs';

const arch = yaml.load(fs.readFileSync('architecture.yaml', 'utf8'));
const result = ArchitectureSchema.safeParse(arch);

if (!result.success) {
  console.error('Invalid architecture.yaml:', result.error);
  process.exit(1);
}

console.log('✅ Valid configuration');
```

## Extending the Format

### Adding New Service Types

The format is extensible. Add your own service types:

```yaml
services:
  ml-training-job:
    type: ml-training           # Custom type
    framework: pytorch
    gpu_count: 4
    dataset: s3://datasets/imagenet
    checkpoint_interval: 1000
    model_output: s3://models/resnet50
```

### Adding New Sections

Create domain-specific sections:

```yaml
ml_pipelines:
  intent: Define ML training and inference workflows

  pipelines:
    image_classification:
      stages: [data-prep, training, evaluation, deployment]
      framework: pytorch
      metrics: [accuracy, f1_score, confusion_matrix]
```

### Custom Validation Rules

Extend Zod schema with your own constraints:

```typescript
const CustomArchitectureSchema = ArchitectureSchema.extend({
  ml_pipelines: z.object({
    intent: z.string(),
    pipelines: z.record(z.object({
      stages: z.array(z.string()),
      framework: z.enum(['pytorch', 'tensorflow', 'jax']),
      metrics: z.array(z.string()),
    })),
  }).optional(),
});
```

## Real-World Adoption Examples

### E-Commerce Platform (This Example)
- **System**: REST APIs + background workers + cron jobs
- **Communication**: HTTP + message queues + webhooks
- **Data**: PostgreSQL + Redis + S3

### Event-Driven Platform (BitBrat)
- **System**: Microservices with routing slips
- **Communication**: Message bus (NATS/Pub/Sub) + HTTP
- **Data**: PostgreSQL + Redis (idempotency)

### ML Training Pipeline
- **System**: Batch jobs + model serving APIs
- **Communication**: File-based (S3) + HTTP inference
- **Data**: S3 (datasets/models) + metadata DB

### SaaS Multi-Tenant Platform
- **System**: REST APIs + background workers + scheduled reports
- **Communication**: HTTP + queues + webhooks
- **Data**: PostgreSQL (per-tenant schemas) + Redis

## Key Takeaways

1. **architecture.yaml v2 is a FORMAT, not an implementation**
2. **Works for ANY system**: REST, event-driven, batch, serverless, monolith
3. **{config, constraints, intent}** is the universal pattern for documentation
4. **llm_guidance** accelerates LLM coding agents across all domains
5. **Multi-environment** support without configuration sprawl
6. **Schema validation** (Zod + JSON Schema) prevents configuration errors
7. **Extensible**: Add your own service types, sections, validation rules

## See Also

- **Full BitBrat implementation**: `architecture.yaml` (1,093 lines, production config)
- **JSON Schema**: `documentation/schemas/architecture.v2.json` (validation reference)
- **Zod Schema**: `tools/brat/src/config/schema.ts` (runtime validation)
- **Migration Guide**: `documentation/guides/sprint-8-architecture-migration.md`
