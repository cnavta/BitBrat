# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

BitBrat is an event-driven LLM orchestration engine built as microservices. The architecture decomposes the classic agent loop (perceive → plan → act → observe) into independent message-passing services. Every service is a **Bit** — a unit built on a common base abstraction that always exposes a universal `bit.*` MCP control plane.

## Key Architectural Concepts

### Single Source of Truth
- **architecture.yaml** is the canonical source of truth for all system configuration, service definitions, and deployment specifications
- All build/deploy tooling derives service metadata from architecture.yaml (ports, entry points, profiles, etc.)
- Never manually edit multiple files for versioning — use `npm run release -- <bump>` to keep architecture.yaml, package.json, and package-lock.json in lockstep

### The Bit Model
Every service is a **Bit** that:
- Extends the `Bit` base class (src/common/base-server.ts)
- Always serves a mandatory `bit.*` control-plane (Platform Ring) via MCP
- Has a `category`: `platform` (core orchestration) or `domain` (optional extensions)
- Composes optional capability profiles (core, gateway, llm, mcp-server)
- Has an `mcp.exposure` level: `platform-only` (just control plane) or `platform+domain` (control plane + domain tools)
- Can be administered uniformly via `brat fleet` commands

### Event-Driven Flow
1. **Ingest**: External events (Twitch/Discord/Twilio) normalized to `internal.ingress.v1` by `ingress-egress`
2. **Route**: `event-router` attaches JsonLogic-driven routing slips that define processing steps
3. **Analyze**: Services like `llm-bot`, `query-analyzer` enrich events via `internal.enriched.v1`
4. **React**: `state-engine`, `disposition-service` apply mutations
5. **Egress**: Responses delivered back via `internal.egress.v1` to the originating platform
6. **Persist**: Events durably captured in Firestore

All messages are `Envelope v1` (see documentation/schemas/envelope.v1.json) with a `routingSlip` that travels with the message.

### Message Bus
- **Local/dev**: NATS JetStream
- **Production**: Google Cloud Pub/Sub
- Selected via `MESSAGE_BUS_DRIVER` environment variable
- Delivery is at-least-once; all consumers MUST be idempotent

## Common Development Commands

### Build & Test
```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript to dist/
npm test                 # Run Jest test suite
npm run lint             # Run ESLint
```

### Local Development
```bash
npm run brat -- setup                # Interactive platform setup (creates .bitbrat.json, seeds Firestore)
npm run brat -- doctor               # Verify environment prerequisites
npm run local                        # Start local Docker Compose stack
npm run local:logs                   # Tail service logs
npm run local:down                   # Stop local stack
npm run brat -- chat                 # Interactive chat with the platform
```

### Service Management
```bash
npm run brat -- bit create <name>                                      # Create a basic core Bit
npm run brat -- bit create <name> --profile gateway --exposure platform+domain  # Create API gateway
npm run brat -- bit create <name> --profile mcp-server                 # Create MCP tool server
npm run brat -- bit create <name> --register --active                  # Create and register in architecture.yaml
```

### Deployment
```bash
npm run brat -- deploy services --all         # Deploy all active services to Cloud Run
npm run brat -- deploy service <name>         # Deploy specific service
npm run brat -- infra plan <module>           # Terraform plan (network/lb/connectors/buckets)
npm run brat -- infra apply <module>          # Apply infrastructure changes
npm run brat -- lb urlmap render              # Generate Load Balancer URL map
```

### Fleet Control Plane (MCP-based administration)
```bash
npm run brat -- fleet list                              # List all live Bits
npm run brat -- fleet info --all                        # Get bit.info from entire fleet
npm run brat -- fleet health <bit>                      # Get bit.health from specific Bit
npm run brat -- fleet config <bit> --describe           # View effective config (redacted)
npm run brat -- fleet flags <bit> get --key <k>         # Inspect feature flag
npm run brat -- fleet flags <bit> set --key <k> --value <v>   # Toggle feature flag (requires bit:operate)
npm run brat -- fleet log <bit> --level debug           # Change runtime log level (requires bit:operate)
npm run brat -- fleet drain <bit> --confirm             # Graceful drain (requires bit:operate)
npm run brat -- fleet shutdown <bit> --confirm          # Shutdown Bit (requires bit:operate)
```

### Version Management
```bash
npm run release:dry -- patch           # Preview version bump (no mutation)
npm run release -- patch               # Bump patch version, update CHANGELOG
npm run release -- minor               # Bump minor version
npm run release -- major               # Bump major version
npm run brat -- release 1.0.0 --tag    # Explicit version with git tag (local only, does not push)
```

**Automated GitHub Releases:**
When a PR with a version bump is merged to `main`, a GitHub Actions workflow automatically:
- Detects the version change in `architecture.yaml`
- Generates LLM-enhanced release notes using GPT-4o-mini
- Creates categorized release notes (Highlights, Features, Fixes, Breaking Changes)
- Creates a git tag (`v<version>`)
- Publishes a GitHub Release

**Prerequisites:**
- `OPENAI_API_KEY` configured as a GitHub repository secret (for LLM enhancement)
- If API key is not configured, releases are created using CHANGELOG.md content only

See `documentation/guides/automated-releases.md` for full details.

### Configuration & Diagnostics
```bash
npm run brat -- config show            # Display resolved platform config
npm run brat -- config validate        # Validate architecture.yaml against schema
```

## Project Structure

```
src/
  apps/              # Service entry points (e.g., llm-bot-service.ts, event-router-service.ts)
  common/            # Shared abstractions (Bit base class, logging, config, events)
  services/          # Service-specific logic organized by domain
  types/             # Shared TypeScript types and event schemas
tools/
  brat/              # Platform CLI (config, deploy, fleet management, backup)
env/
  local/             # Local environment configs (global.yaml, per-service overrides)
  staging/           # Staging configs
  prod/              # Production configs
infrastructure/      # Terraform IaC, Cloud Build configs, deployment scripts
documentation/       # Concepts, reference docs, schemas, tutorials
planning/            # Sprint artifacts (implementation plans, retros, validation scripts)
deprecated/          # Historical code (DO NOT import or depend on in deliverables)
```

## Coding Standards

### Language & Style
- **TypeScript** for all application code (services, shared libraries)
- **kebab-case** for filenames
- **PascalCase** for classes and interfaces
- **camelCase** for functions and variables
- **UPPER_SNAKE_CASE** for constants

### Logging
- Always use the Logger facade (`this.getLogger()` in Bit subclasses)
- Levels: `error` (errors), `warn` (warnings), `info` (useful info), `debug` (deep insight)
- Log all network and filesystem operations with context
- Include `correlationId` in event-related logs

### Error Handling
- Use try/catch discipline throughout
- Validate environment variables on startup
- Gracefully shut down services on SIGTERM/SIGINT
- Message handlers should be idempotent (dedupe on correlationId + step + attempt)

## Testing

### Framework & Location
- **Jest** for all tests (configured in jest.config.js)
- Place tests beside the code or in `__tests__/` directories
- Test files: `*.test.ts` or `*.spec.ts`

### Test Execution
```bash
npm test                           # Run all tests
npm test -- <pattern>              # Run tests matching pattern
npm test -- --watch                # Watch mode
```

### CI Behavior
- In CI environments, Jest runs with `maxWorkers: 1` and `workerThreads: false` for stability
- Firestore is NOT initialized in test runs to prevent lingering async handles

## Critical Constraints

### Never Import from /deprecated
- `./deprecated` contains historical code for reference only
- DO NOT import, execute, copy forward, or make deliverables depend on anything in `./deprecated`

### Environment Configuration
- Service configs are defined in architecture.yaml under `services.<name>.env` and `services.<name>.secrets`
- Secrets are resolved from Google Secret Manager (no values in YAML)
- Local dev uses `.env` files; Cloud Run injects secrets at runtime
- Some integrations (Twilio, Discord) are optional in local development

### Message Versioning
- Topic naming: `internal.<domain>.<verb>.v<version>`
- Bump version on breaking payload changes; never mutate an existing version
- All messages carry `correlationId`, `routingSlip`, and follow Envelope v1 schema

### Building Services
- Standard services build from a single reusable `Dockerfile.service`
- Per-service behavior supplied as `--build-args` derived from architecture.yaml:
  - `SERVICE_NAME`: service key
  - `SERVICE_PORT`: `services.<name>.port` (default 3000)
  - `SERVICE_ENTRY`: entry point mapped from `src/` to `dist/` (e.g., `src/apps/llm-bot-service.ts` → `dist/apps/llm-bot-service.js`)
- Escape hatch: a service may ship its own `Dockerfile.<service>` when the standard image cannot express its needs

## LLM-Specific Workflows (AGENTS.md Protocol)

This repository follows a **rigorous sprint protocol** for LLM-assisted development. If working on sprint-related tasks:

1. **Sprint starts** only when user says "Start sprint"
2. **Only one sprint** active at a time
3. **Planning Phase**: Create `implementation-plan.md` and get user approval BEFORE coding
4. **Execution Phase**: Log every prompt and action in `request-log.md`
5. **Validation Phase**: Create executable `validate_deliverable.sh` (build, test, local run, dry-run deploy)
6. **Verification Phase**: Document completed/partial/deferred items in `verification-report.md`
7. **Publication Phase**: Commit, push feature branch, create GitHub PR
8. **Completion**: Generate `retro.md` and `key-learnings.md`

All sprint artifacts live in `planning/sprint-<id>/`.

## Common Development Patterns

### Creating a New Bit (Service)
1. Run `npm run brat -- bit create <name> [options]`
   - `--profile <p>`: Capability profile (core, gateway, llm, mcp-server) [default: core]
   - `--category <c>`: Architectural category (platform, domain) [default: platform]
   - `--exposure <e>`: MCP exposure (platform-only, platform+domain, none) [default: platform-only]
   - `--kind <k>`: Service kind (pipeline-service, gateway, mcp-server) [default: pipeline-service]
   - `--port <p>`: HTTP port [default: 3000]
   - `--register`: Also register in architecture.yaml
   - `--active`: Mark Bit as active (deployable)
   - `--force`: Overwrite existing files

2. **Profile/Exposure Contract** (enforced by validation):
   - `core` → platform-only | none
   - `gateway` → platform-only | platform+domain | none
   - `llm` → platform-only | none
   - `mcp-server` → platform+domain (required)

3. Generated files:
   - `src/apps/<name>-service.ts`: Service implementation extending `Bit`
   - `src/apps/<name>-service.test.ts`: Test file with supertest setup
   - `Dockerfile.<name>`: Multi-stage build
   - `infrastructure/docker-compose/services/<name>.compose.yaml`: Docker Compose service

4. If not using `--register`, manually add to architecture.yaml under `services:` with:
   - `active: true` (required to enable)
   - `category:` platform or domain
   - `profile:`, `mcp.exposure:`, `kind:`, `entry:`, `port:`
   - Optional: `stage:`, `env:`, `secrets:`

5. Implement service logic in `src/apps/<name>-service.ts`
6. Deploy via `npm run brat -- deploy service <name>`

### Adding a New MCP Tool
- For domain tools, use `--profile mcp-server` when creating the Bit (automatically sets exposure to platform+domain)
- Implement tools using `this.registerTool(name, description, zodSchema, handler)`
- Tool-context binding: `this.registerToolWithContext(name, description, schema, handler, packIds)`
- All Bits automatically get `bit.*` control-plane tools (bit.info, bit.health, bit.config.get, bit.flags.get, bit.log.level, etc.)

### Adding Event Router Rules
- Rules are JsonLogic-based and stored in Firestore (`commands` collection)
- Seeded during `brat setup` (see documentation/guides/seed-data.md)
- Rules attach routing slips that orchestrate event flow
- See documentation/concepts/event-router-rules.md for rule format

### Testing Message Flows
```bash
npm run brat -- chat                # Interactive local chat to test rules/flows
```

### Reading Configuration in Services
```typescript
const config = this.getConfig();          // Full IConfig object
const port = this.getConfig('PORT');      // Single env var (throws if missing)
const secret = this.getSecret('API_KEY'); // Secret (throws if missing)
```

### Publishing to Message Bus
```typescript
// In a Bit subclass:
await this.next(event);                // Advance to next routing step
await this.complete(event);            // Skip routing slip, go directly to egress
```

### Subscribing to Topics
```typescript
// In Bit setup() or constructor
await this.onMessage('internal.llmbot.v1', async (data, attrs, ctx) => {
  // Handle message
  await ctx.ack(); // Manual acknowledgment
});
```

## Important Files & References

- **architecture.yaml**: Canonical system definition (services, messaging, infrastructure)
- **AGENTS.md**: LLM collaboration protocol and sprint workflow
- **README.md**: Comprehensive platform overview and quickstart
- **documentation/concepts/platform-flow.md**: Event lifecycle walkthrough
- **documentation/concepts/bit-model.md**: The Bit abstraction and three rings
- **documentation/reference/bit-control-plane.md**: Universal `bit.*` toolset reference
- **documentation/guides/brat-fleet.md**: Fleet administration guide
- **tsconfig.json**: TypeScript compiler configuration with `@/*` path aliases
- **jest.config.js**: Jest test runner configuration

## Deployment Notes

- **Target platforms**: Docker Compose (local), Google Cloud Run (production)
- **Persistence**: Google Cloud Firestore (only supported backend)
- **Message bus**: NATS (local), Google Cloud Pub/Sub (production)
- **LLM providers**: OpenAI (default), Ollama (local/offline), vLLM (OpenAI-compatible)
- **Scaling**: Most services use min:1, max:1 for cost control; gateways may scale to zero when idle
- **Networking**: VPC connectors for private ranges only; outbound uses Cloud Run default egress

## Troubleshooting

### Build Failures
- Ensure `npm run build` succeeds before deploying
- Check TypeScript errors; the project uses `strict: true`
- Verify no deprecated imports from `./deprecated`

### Test Failures
- Run `npm test` to identify failing specs
- In CI, tests run serially (`maxWorkers: 1`) to avoid segfaults
- Firestore is not initialized in test environments to prevent async handle leaks

### Missing Environment Variables
- Check architecture.yaml for required `env:` and `secrets:` per service
- Run `npm run brat -- config show` to see resolved config
- Use `npm run brat -- doctor` to verify prerequisites

### Local Stack Issues
- Ensure Docker is running
- Check `npm run local:logs` for service errors
- Verify Firestore emulator is accessible (default: localhost:8080)
- Some integrations (Twilio, Discord) are optional in local mode

### MCP Tool Not Found
- Verify tool is registered in service constructor or setup
- Check `mcp.exposure` in architecture.yaml (`platform+domain` exposes domain tools)
- Use `npm run brat -- fleet list` to confirm Bit is registered
- Inspect tools via `npm run brat -- fleet info <bit>`
