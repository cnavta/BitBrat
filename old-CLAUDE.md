# CLAUDE.md

Guidance for Claude Code when working with the BitBrat codebase.

## Overview

BitBrat is an event-driven LLM orchestration engine built as microservices. The architecture decomposes the classic agent loop (perceive → plan → act → observe) into independent message-passing services. Every service is a **Bit** — a unit built on a common base abstraction that always exposes a universal `bit.*` MCP control plane.

## Key Architectural Concepts

### Single Source of Truth
- **architecture.yaml** is the canonical source for all system configuration, service definitions, and deployment specifications
- All build/deploy tooling derives service metadata from architecture.yaml
- Use `npm run release -- <bump>` to keep architecture.yaml, package.json, and package-lock.json synchronized

### The Bit Model
Every service is a **Bit** that:
- Extends `Bit` base class (src/common/base-server.ts)
- Serves mandatory `bit.*` control-plane via MCP
- Has `category`: `platform` (core) or `domain` (extensions)
- Composes capability profiles: core, gateway, llm, mcp-server
- Has `mcp.exposure`: `platform-only` or `platform+domain`
- Administerable via `brat fleet` commands

### Event-Driven Flow
1. **Ingest**: External events normalized to `internal.ingress.v1` by `ingress-egress`
2. **Route**: `event-router` attaches JsonLogic-driven routing slips
3. **Analyze**: Services enrich events via `internal.enriched.v1`
4. **React**: Services apply mutations
5. **Egress**: Responses delivered via `internal.egress.v1`
6. **Persist**: Events captured in PostgreSQL (Firestore legacy/deprecated)

All messages are `Envelope v1` with `routingSlip`. Message bus is NATS (local/dev) or Cloud Pub/Sub (production). Delivery is at-least-once; consumers MUST be idempotent.

### Platform Features

**Scheduler Service**: Platform-agnostic scheduled task execution using `setInterval()` (no external cron). Supports `once` and `cron` schedules. MCP tools: `create_schedule`, `list_schedules`, etc. See `documentation/guides/scheduler.md`.

**Agent-Dev Contexts**: Ephemeral execution contexts for coding agents. Provision via MCP tools (`agent_dev.provision()`, `agent_dev.start()`, `agent_dev.stop()`, `agent_dev.destroy()`). Isolated Docker containers + PostgreSQL. RBAC-enforced `agent-dev-*` prefix. Only one context runs at a time. See `documentation/guides/agent-dev-contexts.md`.

**Execution Contexts**: Unify environment configuration across deployment types. Define in `architecture.yaml` under `executionContexts`. Manage via `brat context list|show|create`. Priority: `--context` flag > `BITBRAT_CONTEXT` env > `~/.bratrc` > `local` default.

## Common Development Commands

### Build & Test
```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm test                 # Run Jest tests
npm run lint             # Run ESLint
```

### Local Development
```bash
npm run brat -- setup    # Interactive setup
npm run brat -- doctor   # Verify prerequisites
npm run local            # Start Docker Compose stack
npm run local:logs       # Tail logs
npm run brat -- chat     # Interactive chat
```

### Service Management
```bash
npm run brat -- bit create <name> [--profile gateway] [--exposure platform+domain] [--register --active]
npm run brat -- deploy service <name>
npm run brat -- deploy services --all
```

### Fleet Control Plane
```bash
npm run brat -- fleet list                              # List all Bits
npm run brat -- fleet info --all                        # Get bit.info
npm run brat -- fleet health <bit>                      # Health check
npm run brat -- fleet config <bit> --describe           # View config
npm run brat -- fleet flags <bit> get --key <k>         # Feature flags
npm run brat -- fleet log <bit> --level debug           # Runtime log level
```

### Version Management
```bash
npm run release -- patch|minor|major    # Bump version
```

**Automated Releases**: On PR merge to `main`, GitHub Actions detects version change, generates LLM-enhanced release notes (GPT-4o-mini), creates git tag and GitHub Release. Requires `OPENAI_API_KEY` repository secret.

## Project Structure

```
src/
  apps/              # Service entry points
  common/            # Shared abstractions (Bit, logging, config)
  services/          # Service-specific logic
  types/             # TypeScript types and schemas
tools/brat/          # Platform CLI
env/                 # Environment configs (local, staging, prod)
infrastructure/      # Terraform, Cloud Build, Docker Compose
documentation/       # Concepts, reference, guides, tutorials
planning/            # Sprint artifacts
deprecated/          # DO NOT import or depend on deprecated code
```

## Coding Standards

### Language & Style
- **TypeScript** (strict mode)
- **kebab-case**: filenames
- **PascalCase**: classes/interfaces
- **camelCase**: functions/variables
- **UPPER_SNAKE_CASE**: constants

### Logging
- Use `this.getLogger()` in Bit subclasses
- Levels: `error`, `warn`, `info`, `debug`
- Include `correlationId` in event logs

### Error Handling
- Use try/catch throughout
- Validate env vars on startup
- Graceful shutdown on SIGTERM/SIGINT
- Idempotent message handlers (dedupe on correlationId + step + attempt)

## Testing

- **Framework**: Jest (jest.config.js)
- **Location**: Beside code or `__tests__/` directories
- **Files**: `*.test.ts` or `*.spec.ts`
- **CI**: `maxWorkers: 1`, `workerThreads: false`
- Persistence backends NOT initialized in tests

## Critical Constraints

### Never Import from /deprecated
`./deprecated` contains historical code for reference only. DO NOT import, execute, or depend on anything in `./deprecated`.

### Environment Configuration
- Defined in architecture.yaml under `services.<name>.env` and `services.<name>.secrets`
- Secrets: `.env` files (local), Secret Manager (cloud)
- Integrations (Twilio, Discord) optional in local dev

### Message Versioning
- Topic naming: `internal.<domain>.<verb>.v<version>`
- Bump version on breaking changes; never mutate existing versions
- All messages carry `correlationId`, `routingSlip`, follow Envelope v1 schema

### Building Services
- Standard `Dockerfile.service` with `--build-args` from architecture.yaml
- Args: `SERVICE_NAME`, `SERVICE_PORT`, `SERVICE_ENTRY`
- Escape hatch: Custom `Dockerfile.<service>` when needed

## Common Development Patterns

### 1. Building Agent-Flow Bits: ENRICH → NEXT Pattern

**THE canonical pattern for bits participating in agent orchestration.**

```typescript
// src/apps/sentiment-analyzer.ts
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

export class SentimentAnalyzer extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      async (event, attrs, ctx) => {
        // 1. ENRICH: Add annotation
        event.annotations.push({
          kind: 'sentiment',
          value: this.analyzeSentiment(event.message?.text || ''),
          source: this.name,     // REQUIRED: provenance
          id: randomUUID(),      // REQUIRED: unique ID
          createdAt: new Date().toISOString()  // REQUIRED
        });

        // 2. NEXT: Advance routing slip
        await this.next(event);

        // 3. ACK: Required
        await ctx.ack();
      }
    );
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    if (/love|great|awesome/i.test(text)) return 'positive';
    if (/hate|terrible|bad/i.test(text)) return 'negative';
    return 'neutral';
  }
}
```

**Rules:**
- Use `next(event)` by default (advances to next step or egress)
- Use `complete(event)` ONLY to short-circuit remaining routing slip
- ALWAYS add annotations (never modify payload unless you own the event type)
- ALWAYS set `source: this.name`, `id`, `createdAt`
- NEVER forget `ctx.ack()` (events will stall)

**Stage-to-Topic Mapping:**

| Stage | Topic | Use Case |
|-------|-------|----------|
| Contextualization | `internal.contextualization.v1` | Auth, env context |
| Analysis | `internal.analysis.v1` | Reasoning, analysis |
| Reaction | `internal.reaction.v1` | Actions, state mutations |

**Examples**: `auth` (src/apps/auth-service.ts:67), `llm-bot` (src/apps/llm-bot-service.ts:123), `query-analyzer` (src/apps/query-analyzer-service.ts:45)

**Documentation**: [Agent Flow Patterns](./documentation/concepts/agent-flow-patterns.md), [5-Stage Model](./documentation/concepts/agent-flow-stages.md), [Tutorial](./documentation/tutorials/building-an-enrichment-bit.md)

---

### 2. Integrating Chat Platforms: IngressConnector + WebhookConnector

**Pattern for external chat platforms (Twilio, Slack, Discord).**

```typescript
// src/services/ingress/<platform>/connector-adapter.ts
export class PlatformConnectorAdapter implements IngressConnector, WebhookConnector {
  // IngressConnector: Real-time messaging
  async start(): Promise<void> { await this.client.start(); }
  async stop(): Promise<void> { await this.client.stop(); }

  // WebhookConnector: Event notifications
  verifySignature(req: WebhookRequest): boolean {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const url = `${protocol}://${req.headers['host']}${req.url}`;
    return validatePlatformSignature(secret, signature, url, req.body);
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    // CRITICAL: Return 200 OK within 3 seconds
    logger.info('platform.webhook.received', req.body);

    // Defer heavy processing
    setImmediate(async () => {
      await processEvent(req.body);
    });

    return { status: 200, body: { ok: true } };
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'platform-name',
      version: '1.0.0',
      capabilities: {
        ingress: { method: 'hybrid', realtime: true },
        egress: { chat: true, dm: true, reactions: true },
        moderation: { ban: false, timeout: false }
      }
    };
  }
}
```

**Critical Rules:**
- ALWAYS return 200 OK within 3 seconds (platforms retry slow webhooks)
- Use `setImmediate()` for async processing after response
- Verify signature synchronously
- Use `x-forwarded-proto` for URL reconstruction (cloud proxies terminate SSL)
- Register with ConnectorManager in `ingress-egress-service.ts`
- Provide accurate ConnectorMetadata

**Examples**: Twilio (src/services/ingress/twilio/), Discord (src/services/ingress/discord/)

**Discord specifics**: Uses Ed25519 signatures (not HMAC). Gateway API (primary) + Interactions API (webhooks, optional). Debug mode: `!debug` prefix with RBAC.

**Documentation**: [Adding Ingress Platform](./documentation/guides/adding-ingress-platform.md), [Webhook Handler](./src/services/ingress/core/webhook-handler.ts)

---

### 3. Building oclif Commands for brat CLI

**All new brat commands extend BratCommand (Sprint 359+).**

```typescript
// tools/brat/src/oclif-commands/doctor.ts
import { Flags } from '@oclif/core';
import { BratCommand } from './base';

export default class Doctor extends BratCommand {
  static description = 'Run system diagnostics';
  static examples = ['<%= config.bin %> <%= command.id %>'];

  static flags = {
    ...BratCommand.baseFlags,  // Inherits --context, --verbose
    json: Flags.boolean({ description: 'JSON output', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    this.logger.debug('Running diagnostics');

    // Command logic
    const checks = { node: { ok: true, version: process.version } };

    // Output
    if (flags.json) {
      this.log(JSON.stringify(checks, null, 2));
    } else {
      for (const [name, check] of Object.entries(checks)) {
        this.log(`- ${name}: ${check.ok ? 'OK' : 'MISSING'}`);
      }
    }
  }
}
```

**BratCommand provides:**
- Pino logger (`this.logger`)
- Execution context (`this.context`)
- Repository root (`this.repoRoot`)
- Global flags (inherited)
- Dependency injection pattern

**Critical Rules:**
- ALWAYS extend `BratCommand` (never oclif `Command` directly)
- ALWAYS include `...BratCommand.baseFlags`
- ALWAYS use `this.logger` (never `console.log`)
- ALWAYS use `this.log()` for user output
- NEVER access `this.context`/`this.logger` in constructor

**Documentation**: [oclif docs](https://oclif.io/), [Migration Guide](../planning/sprint-359-brat-cli-reorganization/oclif-migration-guide.md)

---

### 4. Creating a New Bit (Service)

```bash
npm run brat -- bit create <name> \
  --profile <core|gateway|llm|mcp-server> \
  --category <platform|domain> \
  --exposure <platform-only|platform+domain|none> \
  --register --active
```

**Profile/Exposure Contract** (enforced):
- `core` → platform-only | none
- `gateway` → platform-only | platform+domain | none
- `llm` → platform-only | none
- `mcp-server` → platform+domain (required)

**Generated files**: `src/apps/<name>-service.ts`, test file, Dockerfile, docker-compose service

---

### 5. Deploying Secure Files (Sprint 374)

**Pattern for credentials/certificates that must NEVER be committed to git.**

```yaml
# architecture.yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.local/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        permissions: "0400"
        required: false
        context: local
```

**Properties:**
- `local` (required): Path relative to repo (must be git-ignored)
- `target` (required): Container path under `/var/secrets/` or `/run/secrets/`
- `env` (optional): Environment variable to set
- `permissions` (optional): Default `"0400"`
- `required` (optional): Default `true`
- `context` (optional): Deploy only in specific context

**Platform behavior:**
- Local: Direct volume mount
- Remote: SCP + volume mount
- Cloud Run: Upload to Secret Manager

**Secrets organization:**
- `.secure.{ENV}/.env` → Environment variables (loaded by EnvironmentResolver)
- `.secure.{ENV}/*.json` → Credential files (mounted via secureFiles)
- `.secure.{ENV}/*.pem` → Certificates/keys (mounted via secureFiles)

---

### 6. Automatic Port Assignment (Sprint 379)

PortManager auto-assigns unique ports for all deployments. Discovers ports via `docker ps`, assigns next available from 3001.

```bash
npm run brat -- deploy services --all
# Output: Port assignments: llm-bot:3001(auto), tool-gateway:3002(auto)

# Override:
LLM_BOT_HOST_PORT=5000 npm run brat -- deploy service llm-bot
```

Works with remote Docker via SSH. Gracefully degrades on discovery failures.

---

### Quick Reference Patterns

**Adding MCP Tool:**
```typescript
this.registerTool(name, description, zodSchema, handler);
this.registerToolWithContext(name, description, schema, handler, packIds);
```

**Reading Configuration:**
```typescript
const config = this.getConfig();          // Full IConfig
const port = this.getConfig('PORT');      // Single var (throws if missing)
const secret = this.getSecret('API_KEY'); // Secret (throws if missing)
```

**Publishing to Message Bus:**
```typescript
await this.next(event);      // Advance routing slip
await this.complete(event);  // Skip to egress
```

**Subscribing to Topics:**
```typescript
await this.onMessage('internal.llmbot.v1', async (data, attrs, ctx) => {
  // Handle message
  await ctx.ack();
});
```

## Important Files & References

- **architecture.yaml**: Canonical system definition
- **AGENTS.md**: Sprint protocol (only relevant when user says "Start sprint")
- **README.md**: Platform overview
- **documentation/concepts/platform-flow.md**: Event lifecycle
- **documentation/concepts/bit-model.md**: Bit abstraction
- **documentation/reference/bit-control-plane.md**: `bit.*` toolset
- **documentation/reference/topic-catalog.md**: Message bus topics
- **documentation/reference/secrets-catalog.md**: Platform secrets
- **documentation/reference/environment-variables.md**: Config resolution
- **documentation/guides/extending-bitbrat.md**: Extension guide
- **documentation/guides/brat-fleet.md**: Fleet administration

## Deployment Notes

- **Platforms**: Docker (platform-agnostic: local, cloud, self-hosted). Validated: GCP Cloud Run, AWS ECS, Azure Container Instances
- **Persistence**: PostgreSQL (default, platform-agnostic), Firestore (legacy, deprecated)
- **Message bus**: NATS (default), Cloud Pub/Sub, AWS SQS/SNS, Azure Service Bus
- **LLM providers**: OpenAI (default), Ollama (local), vLLM
- **Scaling**: Most services min:1 max:1; gateways may scale to zero (cloud only)

## Troubleshooting

**Build failures**: Ensure `npm run build` succeeds. Check TypeScript errors (strict mode). No imports from `./deprecated`.

**Test failures**: `npm test` to identify issues. CI runs `maxWorkers: 1`. Persistence NOT initialized in tests.

**Missing env vars**: Check architecture.yaml `env:`/`secrets:`. Use `brat config show` or `brat doctor`.

**Local stack issues**: Ensure Docker running. Check `npm run local:logs`. Verify PostgreSQL accessible (localhost:5432).

**Persistence issues**: Check `DATABASE_URL`. Ensure migrations ran. Switch to PostgreSQL if using deprecated Firestore.

**MCP tool not found**: Verify tool registered in service. Check `mcp.exposure` in architecture.yaml. Use `brat fleet list` and `brat fleet info <bit>`.

## Documentation Philosophy

When creating/updating documentation:
- **Critical info first**: First 100 words = What/How/Why
- **Dense structure**: Tables > prose, lists > paragraphs, descriptive headers
- **Technical precision**: Exact terms, no ambiguous pronouns, file paths for code refs
- **Platform-agnostic**: PostgreSQL (default), Firestore (legacy); Docker (baseline), GCP/AWS/Azure (validated options)

Full structure guidelines in deprecated section (not critical for coding tasks).
