# Extending BitBrat

This guide covers how to extend the BitBrat platform by adding new services (Bits), MCP tools, event router rules, execution contexts, and infrastructure providers. BitBrat's modular architecture enables extension through well-defined patterns and CLI scaffolding.

## Quick Reference

```bash
# Create a new core service
brat bit create <name> --profile core --register --active

# Create an MCP tool server
brat bit create <name> --profile mcp-server --register --active

# Create an API gateway
brat bit create <name> --profile gateway --exposure platform+domain --register

# Create an LLM-enabled service
brat bit create <name> --profile llm --register --active

# Deploy the new service
brat deploy service <name> --context local
```

## Extension Points Overview

| Extension Point | When to Use | Primary Tool | Documentation |
|----------------|-------------|--------------|---------------|
| **Add Service** | Create new message-processing Bit, API gateway, or LLM service | `brat bit create` | This guide, [Bit Model](../concepts/bit-model.md) |
| **Add MCP Tool** | Expose domain-specific tools to LLM agents | `brat bit create --profile mcp-server` | This guide, [MCP Tools](../concepts/mcp-tools.md) |
| **Add Router Rule** | Define event routing logic for new workflows | `brat setup` (seeding) | [Event Router Rules](../concepts/event-router-rules.md) |
| **Add Execution Context** | Create new deployment environment | `brat context create` | [Execution Contexts](../concepts/execution-contexts.md) |
| **Add Infrastructure** | Integrate new cloud provider or infrastructure module | Manual configuration | [Infrastructure](../concepts/infrastructure.md) |

---

## Adding a New Service (Bit)

**Use Case**: Create a new message-processing service, API gateway, LLM integration, or MCP tool server.

### Service Categories

BitBrat services fall into two categories:

- **Platform Services** (`category: platform`): Core orchestration services (ingress-egress, event-router, auth, llm-bot, etc.)
- **Domain Services** (`category: domain`): Optional extensions for specialized functionality (image-gen-mcp, obs-mcp, story-engine-mcp, etc.)

### Service Profiles

Services compose capability profiles that determine scaffolding and dependencies:

| Profile | Use Case | MCP Exposure Options | Auto-Includes |
|---------|----------|---------------------|---------------|
| **core** | Message-processing pipeline service | `platform-only`, `none` | Base Bit, Logger, Config, Message Bus |
| **gateway** | HTTP API gateway with routing | `platform-only`, `platform+domain`, `none` | Express, Middleware, Request validation |
| **llm** | LLM-enabled service (OpenAI, Ollama) | `platform-only`, `none` | OpenAI client, Retry logic, Token counting |
| **mcp-server** | MCP tool server for agent integration | `platform+domain` (required) | MCP SDK, Tool registration, Zod validation |

### Step-by-Step: Creating a Core Service

**Scenario**: Create a sentiment analyzer that enriches events with sentiment annotations.

#### 1. Scaffold the Service

```bash
# Create service with core profile
brat bit create sentiment-analyzer \
  --profile core \
  --category platform \
  --exposure platform-only \
  --port 3008 \
  --register \
  --active
```

**Generated Files**:
- `src/apps/sentiment-analyzer-service.ts` - Service implementation
- `src/apps/sentiment-analyzer-service.test.ts` - Test file with supertest setup
- `Dockerfile.sentiment-analyzer` - Multi-stage Docker build
- `infrastructure/docker-compose/services/sentiment-analyzer.compose.yaml` - Docker Compose service definition

**architecture.yaml Entry** (auto-added with `--register`):
```yaml
services:
  sentiment-analyzer:
    active: true
    category: platform
    profile: core
    kind: pipeline-service
    entry: apps/sentiment-analyzer-service
    port: 3008
    mcp:
      exposure: platform-only
    stage: analysis
    env: {}
    secrets: []
```

#### 2. Implement Service Logic

Edit `src/apps/sentiment-analyzer-service.ts`:

```typescript
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

export class SentimentAnalyzer extends Bit {
  async setup(): Promise<void> {
    // Subscribe to events during analysis stage
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      async (event, attrs, ctx) => {
        const logger = this.getLogger();
        logger.info('sentiment-analyzer.processing', {
          correlationId: event.correlationId,
          text: event.message?.text?.substring(0, 50),
        });

        // ENRICH: Add sentiment annotation
        const sentiment = this.analyzeSentiment(event.message?.text || '');
        event.annotations.push({
          kind: 'sentiment',
          value: sentiment,
          source: this.name,  // REQUIRED: provenance tracking
          id: randomUUID(),   // REQUIRED: unique ID
          createdAt: new Date().toISOString(),  // REQUIRED: timestamp
        });

        logger.debug('sentiment-analyzer.enriched', { sentiment });

        // NEXT: Advance to next routing step
        await this.next(event);

        // ACKNOWLEDGE: Required (event will stall without this)
        await ctx.ack();
      }
    );

    this.getLogger().info('sentiment-analyzer.ready');
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const positiveWords = /love|great|awesome|excellent|happy|good|amazing/i;
    const negativeWords = /hate|terrible|awful|bad|sad|angry|worst/i;

    if (positiveWords.test(text)) return 'positive';
    if (negativeWords.test(text)) return 'negative';
    return 'neutral';
  }
}
```

#### 3. Add Tests

Edit `src/apps/sentiment-analyzer-service.test.ts`:

```typescript
import { SentimentAnalyzer } from './sentiment-analyzer-service';
import { InternalEventV2 } from '../types/events';

describe('SentimentAnalyzer', () => {
  let service: SentimentAnalyzer;

  beforeEach(() => {
    service = new SentimentAnalyzer();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should enrich event with positive sentiment', async () => {
    const event: InternalEventV2 = {
      correlationId: 'test-123',
      message: { text: 'I love this feature!' },
      annotations: [],
      routingSlip: { steps: [] },
    };

    // Test private method via reflection (for unit testing)
    const sentiment = service['analyzeSentiment'](event.message.text);
    expect(sentiment).toBe('positive');
  });

  it('should detect negative sentiment', async () => {
    const sentiment = service['analyzeSentiment']('This is terrible');
    expect(sentiment).toBe('negative');
  });

  it('should default to neutral sentiment', async () => {
    const sentiment = service['analyzeSentiment']('The sky is blue');
    expect(sentiment).toBe('neutral');
  });
});
```

#### 4. Build and Test Locally

```bash
# Build TypeScript
npm run build

# Run tests
npm test -- sentiment-analyzer

# Deploy to local Docker
brat deploy service sentiment-analyzer --context local

# Verify service is running
docker ps | grep sentiment-analyzer

# Check logs
docker logs bitbrat-sentiment-analyzer-1 --tail 50 --follow

# Test via fleet command
brat fleet info sentiment-analyzer
```

#### 5. Update Event Router Rules

If your service participates in event routing, add it to routing slips.

See [Adding Event Router Rules](#adding-event-router-rules) below.

---

### Step-by-Step: Creating an MCP Tool Server

**Scenario**: Create a weather lookup tool server for LLM agents.

#### 1. Scaffold the MCP Server

```bash
# Create MCP server (automatically sets exposure to platform+domain)
brat bit create weather-mcp \
  --profile mcp-server \
  --category domain \
  --port 3009 \
  --register \
  --active
```

**Generated Files**:
- `src/apps/weather-mcp-service.ts` - MCP server with tool registration examples
- `src/apps/weather-mcp-service.test.ts` - Test file
- `Dockerfile.weather-mcp` - Docker build
- `infrastructure/docker-compose/services/weather-mcp.compose.yaml` - Compose service

**architecture.yaml Entry**:
```yaml
services:
  weather-mcp:
    active: true
    category: domain
    profile: mcp-server
    kind: mcp-server
    entry: apps/weather-mcp-service
    port: 3009
    mcp:
      exposure: platform+domain  # Required for mcp-server profile
    env:
      WEATHER_API_KEY: ${WEATHER_API_KEY}
    secrets:
      - WEATHER_API_KEY
```

#### 2. Implement MCP Tools

Edit `src/apps/weather-mcp-service.ts`:

```typescript
import { Bit } from '../common/base-server';
import { z } from 'zod';

export class WeatherMCP extends Bit {
  async setup(): Promise<void> {
    // Register MCP tool: get_current_weather
    this.registerTool(
      'get_current_weather',
      'Get current weather for a location',
      z.object({
        location: z.string().describe('City name or coordinates (lat,lon)'),
        units: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
      }),
      async (args) => {
        const logger = this.getLogger();
        logger.info('weather.lookup', { location: args.location, units: args.units });

        // Call external weather API
        const apiKey = this.getSecret('WEATHER_API_KEY');
        const response = await fetch(
          `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${args.location}`
        );

        if (!response.ok) {
          throw new Error(`Weather API error: ${response.statusText}`);
        }

        const data = await response.json();

        return {
          location: data.location.name,
          temperature: args.units === 'celsius' ? data.current.temp_c : data.current.temp_f,
          units: args.units,
          condition: data.current.condition.text,
          humidity: data.current.humidity,
          wind_speed: data.current.wind_kph,
        };
      }
    );

    // Register MCP tool: get_forecast
    this.registerTool(
      'get_forecast',
      'Get weather forecast for the next N days',
      z.object({
        location: z.string().describe('City name or coordinates'),
        days: z.number().min(1).max(7).default(3).describe('Number of days (1-7)'),
      }),
      async (args) => {
        const apiKey = this.getSecret('WEATHER_API_KEY');
        const response = await fetch(
          `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${args.location}&days=${args.days}`
        );

        if (!response.ok) {
          throw new Error(`Weather API error: ${response.statusText}`);
        }

        const data = await response.json();

        return {
          location: data.location.name,
          forecast: data.forecast.forecastday.map((day: any) => ({
            date: day.date,
            max_temp: day.day.maxtemp_c,
            min_temp: day.day.mintemp_c,
            condition: day.day.condition.text,
            chance_of_rain: day.day.daily_chance_of_rain,
          })),
        };
      }
    );

    this.getLogger().info('weather-mcp.ready', { tools: 2 });
  }
}
```

#### 3. Add Environment Variables

Add secrets to `.secure.local/.env`:

```bash
# .secure.local/.env
WEATHER_API_KEY=your_api_key_here
```

Add to `env/local/weather-mcp.yaml` (optional overrides):

```yaml
# env/local/weather-mcp.yaml
WEATHER_CACHE_TTL_SECONDS: "300"  # Cache weather data for 5 minutes
```

#### 4. Deploy and Test

```bash
# Build and deploy
npm run build
brat deploy service weather-mcp --context local

# Verify MCP tools are registered
brat fleet info weather-mcp

# Expected output shows:
# MCP Tools (Domain): get_current_weather, get_forecast

# Test tool via tool-gateway (requires running local stack)
curl -X POST http://localhost:3001/mcp/weather-mcp/call \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "get_current_weather",
    "arguments": {
      "location": "San Francisco",
      "units": "fahrenheit"
    }
  }'
```

#### 5. Use Tools in LLM Sessions

MCP tools are automatically discovered by coding agents connected via `brat code`:

```bash
# Launch Claude Code with BitBrat context
brat code

# Tools are auto-discovered and available to the agent
# Example agent query: "What's the weather in Tokyo?"
```

---

### Service Profile Details

#### Core Profile

**Use Case**: Message-processing pipeline services (event enrichment, analysis, routing).

**Scaffolded Imports**:
```typescript
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
```

**Pattern**: Enrich-and-Next
- Subscribe to topic (`this.onMessage`)
- Enrich event with annotations
- Advance routing slip (`this.next(event)`)
- Acknowledge message (`ctx.ack()`)

**Examples**: `auth`, `llm-bot`, `query-analyzer`, `sentiment-analyzer`

---

#### Gateway Profile

**Use Case**: HTTP API gateways, webhook receivers, public-facing APIs.

**Scaffolded Imports**:
```typescript
import { Bit } from '../common/base-server';
import express, { Express, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
```

**Pattern**: Express App with Middleware
- Expose HTTP endpoints via Express
- Validate requests with express-validator
- Route to internal message bus or MCP tools
- Return HTTP responses

**Examples**: `tool-gateway`, `ingress-egress`, `webhooks` (planned)

---

#### LLM Profile

**Use Case**: Services that invoke LLM APIs (OpenAI, Ollama, vLLM).

**Scaffolded Imports**:
```typescript
import { Bit } from '../common/base-server';
import OpenAI from 'openai';
import { InternalEventV2 } from '../types/events';
```

**Pattern**: LLM Invocation with Retry
- Configure OpenAI client (or Ollama/vLLM)
- Implement retry logic with exponential backoff
- Track token usage and costs
- Enrich events with LLM responses

**Examples**: `llm-bot`, `llm-query-analyzer` (planned)

---

#### MCP-Server Profile

**Use Case**: Expose domain-specific tools to LLM agents via MCP protocol.

**Scaffolded Imports**:
```typescript
import { Bit } from '../common/base-server';
import { z } from 'zod';
```

**Pattern**: Tool Registration
- Register tools with Zod schemas (`this.registerTool`)
- Implement tool handlers (async functions)
- Return structured results
- Tools proxied and secured by `tool-gateway`

**Examples**: `image-gen-mcp`, `obs-mcp`, `story-engine-mcp`, `weather-mcp`

---

## Adding Event Router Rules

**Use Case**: Define JsonLogic rules that attach routing slips to events based on conditions (user role, message content, platform, etc.).

### Event Router Overview

The **event-router** service matches incoming events against JsonLogic rules and attaches routing slips that define processing steps. This enables declarative event orchestration without hardcoding service dependencies.

### Rule Structure

Event router rules are stored in the database (`commands` collection for Firestore, `commands` table for PostgreSQL) and follow this schema:

```typescript
interface RouterRule {
  id: string;                    // Unique rule identifier
  name: string;                  // Human-readable name
  description: string;           // What this rule does
  enabled: boolean;              // Enable/disable rule
  priority: number;              // Execution order (lower = higher priority)
  condition: JsonLogicRule;      // JsonLogic rule for matching events
  action: {
    type: 'attach_routing_slip';
    routingSlip: {
      steps: Array<{
        service: string;         // Service name (e.g., 'auth', 'llm-bot')
        topic: string;           // Target topic (e.g., 'internal.contextualization.v1')
        optional?: boolean;      // Skip if service unavailable
      }>;
    };
  };
}
```

### Step-by-Step: Adding a Router Rule

**Scenario**: Route all messages from Twitch moderators through a priority processing pipeline.

#### 1. Define the Rule

Create `planning/seed-data/router-rules/twitch-moderator-priority.json`:

```json
{
  "id": "twitch-moderator-priority",
  "name": "Twitch Moderator Priority Processing",
  "description": "Route messages from Twitch moderators through priority pipeline with elevated permissions",
  "enabled": true,
  "priority": 10,
  "condition": {
    "and": [
      { "===": [{ "var": "platform" }, "twitch"] },
      { "in": ["moderator", { "var": "user.roles" }] }
    ]
  },
  "action": {
    "type": "attach_routing_slip",
    "routingSlip": {
      "steps": [
        {
          "service": "auth",
          "topic": "internal.contextualization.v1",
          "optional": false
        },
        {
          "service": "llm-bot",
          "topic": "internal.analysis.v1",
          "optional": false
        },
        {
          "service": "sentiment-analyzer",
          "topic": "internal.analysis.v1",
          "optional": true
        },
        {
          "service": "disposition-service",
          "topic": "internal.reaction.v1",
          "optional": false
        }
      ]
    }
  }
}
```

#### 2. Seed the Rule

Option A: **Manual Insert** (PostgreSQL):

```bash
# Connect to PostgreSQL
docker exec -it bitbrat-postgres-1 psql -U bitbrat -d bitbrat

# Insert rule
INSERT INTO commands (id, name, description, enabled, priority, condition, action, created_at, updated_at)
VALUES (
  'twitch-moderator-priority',
  'Twitch Moderator Priority Processing',
  'Route messages from Twitch moderators through priority pipeline',
  true,
  10,
  '{"and": [{"===": [{"var": "platform"}, "twitch"]}, {"in": ["moderator", {"var": "user.roles"}]}]}',
  '{"type": "attach_routing_slip", "routingSlip": {"steps": [...]}}',
  NOW(),
  NOW()
);
```

Option B: **Seed via brat setup** (Recommended):

```bash
# Add rule file to planning/seed-data/router-rules/
# Re-run setup to apply new rules
brat setup
```

#### 3. Verify Rule Activation

```bash
# Query event-router to verify rule is loaded
brat fleet info event-router

# Expected output shows rule in active rules list

# Test rule by sending a Twitch message as moderator
brat chat

# In chat interface:
# /platform twitch
# /user moderator
# Hello from moderator!
```

### JsonLogic Rule Examples

**Match by platform**:
```json
{ "===": [{ "var": "platform" }, "discord"] }
```

**Match by message content** (contains keyword):
```json
{ "in": ["help", { "var": "message.text" }] }
```

**Match by user role** (any of multiple roles):
```json
{ "in": [{ "var": "user.role" }, ["admin", "moderator", "vip"]] }
```

**Complex condition** (AND/OR logic):
```json
{
  "and": [
    { "===": [{ "var": "platform" }, "twitch"] },
    {
      "or": [
        { "in": ["!command", { "var": "message.text" }] },
        { ">=": [{ "var": "user.reputation" }, 100] }
      ]
    }
  ]
}
```

### Routing Slip Best Practices

1. **Order matters**: Steps execute in sequence (Contextualization → Analysis → Reaction → Egress)
2. **Use optional: true** for non-critical enrichment services (sentiment, analytics)
3. **Keep slips short**: 3-5 steps maximum (more = higher latency)
4. **Match stage to topic**:
   - Stage 2 (Contextualization): `internal.contextualization.v1`
   - Stage 3 (Analysis): `internal.analysis.v1`
   - Stage 4 (Reaction): `internal.reaction.v1`
5. **Test rules thoroughly**: Use `brat chat` to simulate events before production

### See Also
- [Event Router Rules Reference](../concepts/event-router-rules.md) - Complete JsonLogic reference
- [5-Stage Agent Flow Model](../concepts/agent-flow-stages.md) - Understanding event stages

---

## Adding an Execution Context

**Use Case**: Create a new deployment environment (development, staging, production, or agent-dev).

Execution contexts unify environment configuration across deployment types (docker-compose, cloud-run) and runtime concerns (gateway, persistence, env overlays).

### Step-by-Step: Creating a Production Context

**Scenario**: Create a `prod` context for GCP Cloud Run deployment.

#### 1. Create the Context

```bash
# Interactive wizard
brat context create prod

# Non-interactive mode
brat context create prod \
  --non-interactive \
  --type cloud-run \
  --gcp-project my-bitbrat-prod \
  --gcp-region us-central1 \
  --persistence-driver postgres \
  --pg-host /cloudsql/my-project:us-central1:bitbrat-db \
  --pg-port 5432 \
  --pg-database bitbrat \
  --pg-user bitbrat \
  --pg-password ${POSTGRES_PASSWORD}
```

**Generated architecture.yaml Entry**:
```yaml
executionContexts:
  prod:
    description: "Production environment on GCP Cloud Run"
    deployment:
      type: cloud-run
      cloudRun:
        project: my-bitbrat-prod
        region: us-central1
        allowUnauthenticated: false
        minInstances: 1
        maxInstances: 100
        cpu: "1"
        memory: "512Mi"
        timeout: 300
    runtime:
      gateway:
        url: https://tool-gateway-prod-abc123-uc.a.run.app
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: /cloudsql/my-project:us-central1:bitbrat-db
          port: 5432
          database: bitbrat
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
      envOverlay:
        path: env/prod
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.prod
    tags: [production, gcp, cloud-run]
```

#### 2. Scaffold Environment Files

```bash
# Context creation automatically scaffolds:
# env/prod/global.yaml - Baseline environment variables
# env/prod/infra.yaml - Infrastructure configuration
# .secure.prod/.env - Secrets (git-ignored)

# Verify scaffolded files
ls -la env/prod/
ls -la .secure.prod/
```

**env/prod/global.yaml** (auto-generated):
```yaml
NODE_ENV: production
LOG_LEVEL: info
MESSAGE_BUS_DRIVER: pubsub
BUS_PREFIX: prod
PERSISTENCE_DRIVER: postgres
DATABASE_URL: postgresql://bitbrat:${POSTGRES_PASSWORD}@/cloudsql/my-project:us-central1:bitbrat-db:5432/bitbrat
REDIS_URL: ${REDIS_URL}  # External Redis (Memorystore)
REDIS_IDEMPOTENCY_ENABLED: "true"
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: "300"
```

**env/prod/infra.yaml** (auto-generated):
```yaml
# GCP Pub/Sub configuration
PUBSUB_PROJECT_ID: my-bitbrat-prod
PUBSUB_EMULATOR_HOST: ""  # Use real Pub/Sub, not emulator

# PostgreSQL (Cloud SQL with Unix socket)
POSTGRES_HOST: /cloudsql/my-project:us-central1:bitbrat-db
POSTGRES_PORT: "5432"
POSTGRES_DB: bitbrat
POSTGRES_USER: bitbrat
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

# Redis (Memorystore)
REDIS_HOST: 10.0.0.3
REDIS_PORT: "6379"
```

**.secure.prod/.env** (manually populate):
```bash
# .secure.prod/.env
MCP_AUTH_TOKEN=prod_token_abc123xyz789
POSTGRES_PASSWORD=secure_prod_db_password
REDIS_URL=redis://10.0.0.3:6379
OPENAI_API_KEY=sk-prod-key-here
TWITCH_CLIENT_SECRET=prod_twitch_secret
DISCORD_BOT_TOKEN=prod_discord_token
```

#### 3. Switch to the New Context

```bash
# Switch default context
brat use prod

# Verify current context
brat context list
# Output:
#   local   docker-compose   Local development
#   staging docker-compose   Remote staging
# * prod    cloud-run        Production on GCP  ← Active

# Or use --context flag for one-off commands
brat deploy services --all --context prod
```

#### 4. Deploy to Production

```bash
# Deploy all services to Cloud Run
brat deploy services --all --context prod

# Verify deployments
brat fleet list --context prod

# Check service health
brat fleet health llm-bot --context prod
```

### Context Types

| Type | When to Use | Deployment Mechanism | Persistence Options |
|------|-------------|---------------------|---------------------|
| **docker-compose** | Local dev, self-hosted prod, remote staging | Docker Compose (local or SSH) | PostgreSQL (default), Firestore (legacy) |
| **cloud-run** | GCP serverless production | GCP Cloud Run | Cloud SQL (PostgreSQL), Firestore |
| **ecs** (planned) | AWS container production | AWS ECS Fargate | RDS (PostgreSQL), DynamoDB |
| **k8s** (planned) | Kubernetes production | Helm charts | Any PostgreSQL, managed services |

### See Also
- [Execution Contexts Concept](../concepts/execution-contexts.md) - Deep dive into context architecture
- [Environment Variables Reference](../reference/environment-variables.md) - Complete variable documentation

---

## Adding Infrastructure Providers

**Use Case**: Integrate a new cloud provider (AWS, Azure) or infrastructure module (monitoring, CDN, service mesh).

BitBrat uses a three-tier infrastructure architecture:

1. **platform.infrastructure** - Platform-agnostic baseline (Docker, PostgreSQL, NATS, Redis)
2. **infrastructure.{provider}** - Cloud-specific modules (GCP, AWS, Azure)
3. **executionContexts.{name}** - Deployment-specific configuration

### Step-by-Step: Adding AWS Support

**Scenario**: Add AWS ECS deployment support with RDS PostgreSQL and SQS message bus.

#### 1. Create Provider Configuration

Edit `architecture.yaml` and add AWS infrastructure section:

```yaml
infrastructure:
  aws:
    description: "AWS infrastructure modules for ECS deployment"
    config:
      region: us-east-1
      accountId: "123456789012"
      vpcId: vpc-abc123
    intent: >
      Provides ECS task definitions, RDS PostgreSQL, SQS queues, and ALB configuration.
      All services deploy as Fargate tasks with auto-scaling and health checks.

    modules:
      networking:
        vpcId: vpc-abc123
        subnets:
          private: [subnet-abc123, subnet-def456]
          public: [subnet-ghi789, subnet-jkl012]
        securityGroups:
          services: sg-services-abc123
          database: sg-database-def456
          loadBalancer: sg-alb-ghi789

      persistence:
        rds:
          engine: postgres
          version: "15.4"
          instanceClass: db.t3.medium
          allocatedStorage: 100
          multiAZ: true
          endpoint: bitbrat-prod.abc123.us-east-1.rds.amazonaws.com

      messaging:
        sqs:
          queues:
            - name: internal-ingress-v1
              fifo: false
              messageRetention: 1209600  # 14 days
            - name: internal-analysis-v1
              fifo: false
              messageRetention: 1209600

      compute:
        ecs:
          cluster: bitbrat-prod
          taskDefinitions: {}  # Generated per service
          services: {}         # Generated per service

      loadBalancer:
        alb:
          name: bitbrat-alb
          scheme: internet-facing
          subnets: [subnet-ghi789, subnet-jkl012]
          securityGroups: [sg-alb-ghi789]
          targetGroups: {}  # Generated per service
```

#### 2. Create Terraform Modules

Create Terraform infrastructure code:

```bash
# Create AWS module directory
mkdir -p infrastructure/terraform/aws
cd infrastructure/terraform/aws

# Create module files
touch main.tf variables.tf outputs.tf
touch ecs.tf rds.tf sqs.tf alb.tf
```

**infrastructure/terraform/aws/main.tf**:
```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "bitbrat-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Import configuration from architecture.yaml
locals {
  config = yamldecode(file("${path.root}/../../../architecture.yaml"))
  aws_config = local.config.infrastructure.aws
}
```

**infrastructure/terraform/aws/ecs.tf**:
```hcl
# ECS Cluster
resource "aws_ecs_cluster" "bitbrat" {
  name = local.aws_config.modules.compute.ecs.cluster

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ECS Task Definitions (one per service)
# Generated dynamically from architecture.yaml services
resource "aws_ecs_task_definition" "services" {
  for_each = { for k, v in local.config.services : k => v if v.active }

  family                   = each.key
  requires_compatibilities = ["FARGATE"]
  network_mode            = "awsvpc"
  cpu                     = 512
  memory                  = 1024

  container_definitions = jsonencode([{
    name  = each.key
    image = "${var.ecr_registry}/${each.key}:${local.config.version}"

    portMappings = [{
      containerPort = each.value.port
      protocol      = "tcp"
    }]

    environment = [
      for k, v in merge(
        local.config.defaults.services.env,
        each.value.env
      ) : { name = k, value = v }
    ]

    secrets = [
      for secret in each.value.secrets : {
        name      = secret
        valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:${secret}"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/bitbrat/${each.key}"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}
```

#### 3. Create Execution Context for AWS

```bash
brat context create aws-prod \
  --non-interactive \
  --type ecs \
  --aws-region us-east-1 \
  --aws-cluster bitbrat-prod \
  --persistence-driver postgres \
  --pg-host bitbrat-prod.abc123.us-east-1.rds.amazonaws.com \
  --pg-port 5432
```

#### 4. Implement Deployment Orchestrator

Create AWS-specific deployment orchestrator in `tools/brat/src/orchestration/aws/`:

```typescript
// tools/brat/src/orchestration/aws/ecs-orchestrator.ts
import { Orchestrator } from '../orchestrator';
import { ECS, ECR } from '@aws-sdk/client-ecs';

export class ECSOrchestrator implements Orchestrator {
  private ecs: ECS;
  private ecr: ECR;

  constructor(private config: any) {
    this.ecs = new ECS({ region: config.region });
    this.ecr = new ECR({ region: config.region });
  }

  async deployService(serviceName: string): Promise<void> {
    // 1. Build and push Docker image to ECR
    await this.buildAndPushImage(serviceName);

    // 2. Update ECS task definition
    await this.updateTaskDefinition(serviceName);

    // 3. Update ECS service (triggers rolling deployment)
    await this.updateService(serviceName);

    // 4. Wait for deployment to complete
    await this.waitForDeployment(serviceName);
  }

  private async buildAndPushImage(serviceName: string): Promise<void> {
    // Implementation: docker build + docker push to ECR
  }

  private async updateTaskDefinition(serviceName: string): Promise<void> {
    // Implementation: register new ECS task definition revision
  }

  private async updateService(serviceName: string): Promise<void> {
    // Implementation: update ECS service to use new task definition
  }

  private async waitForDeployment(serviceName: string): Promise<void> {
    // Implementation: poll ECS service until deployment succeeds
  }
}
```

#### 5. Integrate with brat CLI

Update `tools/brat/src/orchestration/orchestrator-factory.ts`:

```typescript
import { ECSOrchestrator } from './aws/ecs-orchestrator';

export function createOrchestrator(context: ExecutionContext): Orchestrator {
  switch (context.deployment.type) {
    case 'docker-compose':
      return new DockerComposeOrchestrator(context);
    case 'cloud-run':
      return new CloudRunOrchestrator(context);
    case 'ecs':  // NEW
      return new ECSOrchestrator(context);
    default:
      throw new Error(`Unsupported deployment type: ${context.deployment.type}`);
  }
}
```

#### 6. Deploy to AWS

```bash
# Apply Terraform infrastructure
cd infrastructure/terraform/aws
terraform init
terraform plan
terraform apply

# Deploy services
brat deploy services --all --context aws-prod

# Verify deployments
brat fleet list --context aws-prod
```

### See Also
- [Infrastructure Concept](../concepts/infrastructure.md) - Three-tier architecture deep dive
- [GCP Infrastructure Reference](../reference/infrastructure-gcp.md) - GCP implementation example
- [Terraform Modules](../../infrastructure/terraform/) - Existing Terraform code

---

## Troubleshooting

### Service Not Starting

**Symptom**: Service container exits immediately after deployment.

**Diagnostic Steps**:
```bash
# Check container logs
docker logs bitbrat-<service>-1 --tail 100

# Check service health
brat fleet health <service>

# Verify environment variables
docker exec bitbrat-<service>-1 env | grep -E '(LOG_LEVEL|MESSAGE_BUS|PERSISTENCE)'
```

**Common Causes**:
1. **Missing environment variable**: Check `env/<context>/global.yaml` and `.secure.<context>/.env`
2. **Database connection failure**: Verify `DATABASE_URL` and PostgreSQL is accessible
3. **Message bus connection failure**: Verify NATS/Pub/Sub is running and accessible
4. **Port conflict**: Check `docker ps` for port collisions

**Solutions**:
- Add missing environment variables to `env/<context>/global.yaml`
- Verify database connectivity: `docker exec bitbrat-<service>-1 nc -zv postgres 5432`
- Restart infrastructure services: `docker compose -f infrastructure/docker-compose/docker-compose.base.yaml restart`

---

### MCP Tools Not Discovered

**Symptom**: MCP tools don't appear in `brat fleet info <service>` output.

**Diagnostic Steps**:
```bash
# Verify service is MCP server
brat config show | grep -A5 "services.<service>"

# Check MCP exposure
# Should show: exposure: platform+domain

# Check tool-gateway logs
docker logs bitbrat-tool-gateway-1 --tail 50 --follow

# Test tool registration directly
curl http://localhost:3001/mcp/<service>/list \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}"
```

**Common Causes**:
1. **Incorrect exposure**: Service has `exposure: platform-only` (should be `platform+domain`)
2. **Tool not registered**: Missing `this.registerTool()` call in service code
3. **Service not active**: `active: false` in architecture.yaml
4. **Tool-gateway not running**: Gateway not deployed or crashed

**Solutions**:
- Update `mcp.exposure` in architecture.yaml to `platform+domain`
- Verify `this.registerTool()` is called in service `setup()` method
- Set `active: true` in architecture.yaml and redeploy
- Restart tool-gateway: `docker restart bitbrat-tool-gateway-1`

---

### Event Router Rule Not Matching

**Symptom**: Events don't trigger expected routing slip despite matching rule condition.

**Diagnostic Steps**:
```bash
# Check active router rules
brat fleet info event-router

# Test JsonLogic rule manually
node -e "
const jsonLogic = require('json-logic-js');
const rule = { /* your rule */ };
const data = { /* your event */ };
console.log(jsonLogic.apply(rule, data));
"

# Enable debug logging on event-router
brat fleet log event-router --level debug

# Send test event and watch logs
brat chat
# (send test message)

# Check event-router logs
docker logs bitbrat-event-router-1 --tail 100 --follow
```

**Common Causes**:
1. **Rule disabled**: `enabled: false` in rule definition
2. **Priority conflict**: Higher priority rule matches first and prevents lower priority rules
3. **Incorrect JsonLogic**: Rule condition doesn't match event structure
4. **Rule not seeded**: Rule exists in JSON file but not inserted into database

**Solutions**:
- Verify rule is enabled in database: `SELECT enabled FROM commands WHERE id = '<rule-id>'`
- Check rule priority: Lower numbers = higher priority (use `priority: 1000+` for debug rules)
- Test JsonLogic with actual event data structure
- Re-run `brat setup` to seed new rules

---

### Deployment Fails with Port Conflict

**Symptom**: `docker compose up` fails with "port already allocated" error.

**Diagnostic Steps**:
```bash
# Find process using port
lsof -i :<port>

# Check running containers
docker ps --format '{{.Names}}\t{{.Ports}}'

# Verify port assignments
env | grep _HOST_PORT
```

**Common Causes**:
1. **Multiple contexts running**: Two execution contexts trying to use same ports
2. **Orphaned containers**: Previous deployment not cleaned up
3. **System service conflict**: Non-Docker process using port

**Solutions**:
- Stop other contexts: `docker compose -f <other-context> down`
- Clean up orphaned containers: `docker compose down --remove-orphans`
- Use automatic port assignment: Let PortManager auto-assign ports (default in Sprint 379+)
- Override port: `LLM_BOT_HOST_PORT=5000 brat deploy service llm-bot`

---

### Context Switch Not Taking Effect

**Symptom**: `brat use <context>` doesn't change active context for deployments.

**Diagnostic Steps**:
```bash
# Check current context
brat context list
# Look for asterisk (*) next to active context

# Verify ~/.bratrc
cat ~/.bratrc | grep currentContext

# Test with explicit context flag
brat deploy service <name> --context <desired-context>
```

**Common Causes**:
1. **Environment variable override**: `BITBRAT_CONTEXT` env var takes precedence over ~/.bratrc
2. **Command-line flag override**: `--context` flag overrides both
3. **Invalid context name**: Typo in context name

**Solutions**:
- Unset env var: `unset BITBRAT_CONTEXT`
- Verify context exists: `brat context list`
- Use explicit flag: `brat deploy service <name> --context <context>`
- Edit ~/.bratrc manually if corrupted

---

## See Also

- [Bit Model](../concepts/bit-model.md) - Understanding the Bit abstraction
- [Event Flow Patterns](../concepts/agent-flow-patterns.md) - Event processing patterns
- [MCP Tools Guide](../concepts/mcp-tools.md) - MCP protocol and tool development
- [Event Router Rules](../concepts/event-router-rules.md) - JsonLogic rule reference
- [Execution Contexts](../concepts/execution-contexts.md) - Context architecture deep dive
- [Infrastructure](../concepts/infrastructure.md) - Three-tier infrastructure model
- [brat CLI Reference](../tools/brat.md) - Complete CLI documentation
- [Environment Variables](../reference/environment-variables.md) - Variable resolution and configuration
- [Secrets Catalog](../reference/secrets-catalog.md) - Platform secrets reference
