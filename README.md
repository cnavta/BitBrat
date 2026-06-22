# BitBrat Platform

> [!WARNING]
> **Early & Experimental Development Stage**: This project started as a way for me to better understand scalable LLM Agent collaboration. As is, it has been mainly a work between myself and a Junie LLM coding agent. It is currently in early development. APIs, configuration schemas, and core architectures are subject to significant changes. We do not recommend using this in a production environment yet.
>
> Several design decisions were deliberately fixed to keep scope simple and focus exploration:
> - The only target platforms are Docker Compose and Google Cloud.
> - The only persistence framework supported is Firestore.
> 
> These both could be fairly easily updated to support additional options, I have just not focused on them specifically in favor of learning and exploring AI agent orchestration.

<p align="center">
  <img src="./assets/assets/BitBrat.png" alt="Description of Image" width="300"/>
</p>

BitBrat Platform is an LLM-powered event orchestration and execution engine currently designed for streamers, though it can easily be adapted for a wide range of use cases. It bridges external event sources (like Twitch, Kick, Discord, and Twilio) with internal processing logic and AI-driven reactions.

## Features

- **Multi-Platform Ingress**: Listen to events from Twitch (IRC & EventSub), Discord, and Twilio Conversations.
- **AI-Driven Reactions**: Integration with OpenAI and Model Context Protocol (MCP) to provide intelligent responses and tool execution.
- **Microservices Architecture**: Scalable, cloud-native services deployed on Google Cloud Platform (Cloud Run).
- **Event-Driven**: Built on top of a robust message bus (NATS locally / Google Cloud Pub/Sub in production) for asynchronous processing.
- **Rule-Driven Routing**: A central Event Router uses [JsonLogic](https://jsonlogic.com/) rules to match, enrich, and route events through configurable processing stages.
- **Extensible**: Easily add new event sources, command processors, or MCP tools.

## Documentation

The `documentation/` folder contains structured guides for getting started, core concepts, and step-by-step tutorials. Start here:

- **Getting Started**
  - [Quickstart: Local Platform Setup](./documentation/getting-started/quickstart.md)
- **Concepts**
  - [Platform Flow Overview](./documentation/concepts/platform-flow.md) — the ingest → analysis → reaction → egress lifecycle.
  - [Event Router & Rules](./documentation/concepts/event-router-rules.md) — rule format and matching logic.
- **Guides**
  - [Managing Seed Data](./documentation/guides/seed-data.md) — initial seeding via `brat setup` and the `firestore:upsert` tool.
- **Tutorials**
  - [Creating a `!lurk` Command](./documentation/tutorials/lurk-command.md) — build your first custom command.
- **Tools**
  - [The `brat` CLI](./documentation/tools/brat.md) — full command reference.
  - [Firestore Upsert Tool](./documentation/tools/firestore-upsert.md) — load JSON data into Firestore.

For the canonical system definition, see [architecture.yaml](./architecture.yaml).

## Architecture

The platform consists of several core services:

- **Ingress-Egress**: The gateway for external platforms. Normalizes inbound events and delivers outbound responses.
- **Auth Service**: Handles user enrichment (roles, tags, `displayName`) and authorization during the analysis stage.
- **Event Router**: Matches incoming events against rules, attaches a routing slip, and advances events through the platform.
- **LLM Bot**: The brain of the platform, processing events using LLMs and MCP tools.
- **Persistence**: Ensures events and states are stored reliably for auditing and long-term memory.
- **Scheduler**: Manages periodic tasks and ticks.

For a detailed view, see [architecture.yaml](./architecture.yaml) and the [Platform Flow Overview](./documentation/concepts/platform-flow.md).

## Getting Started

> The following is a condensed version of the [Quickstart guide](./documentation/getting-started/quickstart.md). Refer to it for full details.

### Prerequisites

- **Node.js** (v24.x or higher)
- **npm**
- **Docker** and Docker Compose
- **Google Cloud SDK (`gcloud`)** — some local configs depend on GCP project structure.
- **Git**
- **OpenAI API Key** — required for LLM-powered features.

### 1. Clone the repository

```bash
git clone https://github.com/BitBrat/BitBratPlatform.git
cd BitBratPlatform
```

### 2. Install dependencies

```bash
npm install
```

### 3. Initialize the platform

```bash
npm run brat -- setup
```

The interactive `setup` command guides you through configuring your **GCP Project ID**, **OpenAI API Key**, and **Bot Name**. It also bootstraps your local environment by:

- **Configuration**: Generating `.bitbrat.json` (admin credentials), `.secure.local` (secrets), and `env/local/global.yaml`.
- **Admin Token**: Creating a unique API token for local administration (used by tools like `brat chat`).
- **Initial Seeding**: Populating the local Firestore emulator with default bot **personalities**, base **Event Router rules** (analysis and bot-mention handling), and initial **authentication tokens**.

See [Managing Seed Data](./documentation/guides/seed-data.md) for details on the seeded data and how to extend it.

### 4. Verify your environment

```bash
npm run brat -- doctor
```

Look for all "PASS" results. The tool provides guidance for any failed checks.

### 5. Run the platform locally

```bash
npm run local        # Start the local stack (Docker Compose)
npm run local:logs   # Tail service logs
npm run local:down   # Stop the local environment
```

### 6. Chat with your bot

Once the platform is running, start an interactive chat session to test rules and interactions locally:

```bash
npm run brat -- chat
```

See the [`brat chat` documentation](./documentation/tools/brat.md#brat-chat) for more options.

### Building and Testing

```bash
npm run build   # Compile the TypeScript project
npm test        # Run the test suite
```

### Container Builds

All standard services are built from a single, reusable **`Dockerfile.service`** at the repo root.
Per-service behavior is supplied as build arguments derived from `architecture.yaml` — there is no
per-service Dockerfile to maintain:

- `SERVICE_NAME` — the service key in `architecture.yaml`.
- `SERVICE_PORT` — `services.<name>.port` (defaults to `3000`).
- `SERVICE_ENTRY` — `services.<name>.entry` mapped from `src/<x>.ts` to `dist/<x>.js`.

```bash
docker build -f Dockerfile.service \
  --build-arg SERVICE_NAME=llm-bot \
  --build-arg SERVICE_ENTRY=dist/apps/llm-bot-service.js \
  --build-arg SERVICE_PORT=3000 \
  -t llm-bot:latest .
```

The deploy tooling (`infrastructure/deploy-cloud.sh`, Cloud Build, and local Compose) wires these
arguments automatically. **Escape hatch:** a service may still ship its own `Dockerfile.<service>`
when it needs something the standard image cannot express (extra OS packages, a different base
image, a non-`src/` build layout, or a prebuilt `image:`); when present, that file takes precedence.
See [Reusable Standard Service Dockerfile](./documentation/technical-architecture/reusable-service-dockerfile.md)
and the [usage guide](./documentation/technical-architecture/standard-service-dockerfile-usage.md).

## Management CLI (brat)

`brat` (BitBrat Rapid Administration Tool) is the primary CLI tool for managing the platform. It simplifies common tasks such as environment validation, service bootstrapping, deployment, and infrastructure management.

For more details, see the [brat documentation](./documentation/tools/brat.md).

**Usage:**
```bash
npm run brat -- <command> [options]
```
*(Note: Use `--` to pass arguments through npm to the underlying script)*

### Global Flags
- `--env <name>`: Specify the environment (e.g., `local`, `dev`, `prod`). Can also be set via `BITBRAT_ENV`.
- `--project-id <id>`: Override the Google Cloud Project ID.
- `--region <name>`: Override the GCP region.
- `--dry-run`: Preview changes without applying them.
- `--json`: Output results in JSON format.

### Core Commands

#### Setup & Interaction
- `brat setup [--project-id <id>] [--openai-key <key>] [--bot-name <name>]`: Interactive platform initialization and local seeding.
- `brat chat [--env <name>] [--url <url>]`: Start an interactive chat session with the platform.

#### Diagnostics & Config
- `brat doctor`: Run diagnostic checks to ensure required tools (`gcloud`, `terraform`, `docker`) are installed.
- `brat config show`: Display the resolved platform configuration.
- `brat config validate`: Validate `architecture.yaml` against the platform schema.

#### Local Environment
- `brat docker up --env local`: Start the local stack (aliased as `npm run local`).
- `brat docker logs --env local`: Tail local logs (aliased as `npm run local:logs`).
- `brat docker down --env local`: Stop the local stack (aliased as `npm run local:down`).

#### Service Management
- `brat service bootstrap --name <name> [--mcp] [--force]`: Create a new service from a template. Use `--mcp` for Model Context Protocol servers.

#### Deployment
- `brat deploy services --all`: Deploy all services defined in `architecture.yaml`.
- `brat deploy service <name>`: Deploy a specific service (alias: `brat deploy <name>`).

#### Infrastructure (IaC)
- `brat infra plan <module>`: Generate an execution plan for infrastructure changes.
- `brat infra apply <module>`: Apply infrastructure changes.
- **Modules**: `network`, `lb` (load-balancer), `connectors`, `buckets`.

#### Load Balancer
- `brat lb urlmap render`: Generate the GCP Load Balancer URL map YAML.
- `brat lb urlmap import`: Import the rendered URL map into Google Cloud.

#### Google Cloud Platform
- `brat apis enable`: Enable required Google Cloud APIs.
- `brat cloud-run shutdown`: Stop all Cloud Run services in the environment (cost-saving).

#### CI/CD Triggers
- `brat trigger create --name <n> --repo <repo> --branch <regex> --config <path>`: Manage Cloud Build triggers.

## Event Messaging & Flow

The BitBrat platform follows a robust, event-driven architecture built on a unified message bus (NATS locally, Google Cloud Pub/Sub in production) and a standardized internal event contract.

### The Event Lifecycle

Events flow through a series of decoupled stages. For the full breakdown, see the [Platform Flow Overview](./documentation/concepts/platform-flow.md).

1. **Ingest**: External platforms (Twitch, Discord, Twilio) hit the `Ingress-Egress` service. It normalizes the raw payload into the internal event format and publishes to `internal.ingress.v1`.
2. **Analysis**: The event is enriched (e.g., the `Auth Service` populates user metadata such as `displayName`) and evaluated by the **Event Router** against active rules. Matching rules attach a **routing slip** that defines the remaining processing path. Analysis services like the **LLM Bot** or **Query Analyzer** may add annotations or candidate responses, returning the event via `internal.enriched.v1`.
3. **Reaction**: Once analysis is complete, the Event Router advances the event to the `reaction` stage, where reactive services (e.g., **State Engine**, **Disposition Service**) act on it. If a rule's routing slip is empty, `BaseServer.next()` automatically routes the event to egress.
4. **Egress**: The event is delivered back to the originating `Ingress-Egress` instance, which selects the best candidate reply and sends it to the target platform.
5. **Persistence**: The `Persistence` service stores final state, selections, and errors for auditing and long-term memory.

> **Tip:** Command rules typically trigger during the `analysis` stage (where `user.displayName` is already available), then advance to `reaction` for delivery. See [Event Router & Rules](./documentation/concepts/event-router-rules.md) for the rule format and stage-filtering best practices.

### Development Primitives

All services leverage `BaseServer` for standardized messaging patterns:

- **`onMessage<T>(topic, handler)`**: Unified subscription to the message bus with automatic event conversion.
- **`next(event)`**: Automatically advances the event to the next pending step in the routing slip (or to egress when the slip is empty).
- **`complete(event)`**: Bypasses the remaining routing slip and sends the event directly to its egress destination.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Security

For security-related issues, please refer to [SECURITY.md](./SECURITY.md).
