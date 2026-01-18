# BitBrat Platform

> [!WARNING]
> **Early & Experimental Development Stage**: This project started as a way for me to better understand scalable LLM Agent collaboration. As is, it has been mainly a work between myself and a Junie LLM coding agent. It is currently in early development. APIs, configuration schemas, and core architectures are subject to significant changes. We do not recommend using this in a production environment yet.

<p align="center">
  <img src="./assets/BitBrat.png" alt="Description of Image" width="300"/>
</p>

BitBrat Platform is an LLM-powered event orchestration and execution engine currently designed for streamers, though can easily be adapted for a wide range of use cases. It bridges external event sources (like Twitch, Kick, Discord, and Twilio) with internal processing logic and AI-driven reactions.

## Features

- **Multi-Platform Ingress**: Listen to events from Twitch (IRC & EventSub), Discord, and Twilio Conversations.
- **AI-Driven Reactions**: Integration with OpenAI and Model Context Protocol (MCP) to provide intelligent responses and tool execution.
- **Microservices Architecture**: Scalable, cloud-native services deployed on Google Cloud Platform (Cloud Run).
- **Event-Driven**: Built on top of a robust message bus (NATS/PubSub) for asynchronous processing.
- **Extensible**: Easily add new event sources, command processors, or MCP tools.

## Architecture

The platform consists of several core services:

- **Ingress-Egress**: The gateway for external platforms.
- **Auth Service**: Handles user enrichment and authorization.
- **Event Router**: Assigns routing slips to incoming events.
- **LLM Bot**: The brain of the platform, processing events using LLMs.
- **Command Processor**: Executes specific bot commands.
- **Persistence**: Ensures events and states are stored reliably.
- **Scheduler**: Manages periodic tasks and ticks.

For a detailed view, see [architecture.yaml](./architecture.yaml) and the [documentation](./documentation) folder.

## Getting Started

### Prerequisites

- Node.js (v24.x recommended)
- npm
- Google Cloud Project (for GCP deployment)
- NATS Server (for local development)
- Firebase/Firestore

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/cnavta/BitBrat.git
   cd BitBrat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Copy `.env.example` (to be created) to `.env` and fill in the required values.

### Running Locally

To start the platform locally using Docker Compose:
```bash
npm run local
```

To stop the local environment:
```bash
npm run local:down
```

### Building and Testing

Build the project:
```bash
npm run build
```

Run tests:
```bash
npm test
```

## Management CLI (brat)

`brat` (BitBrat Rapid Administration Tool) is the primary CLI tool for managing the platform. It simplifies common tasks such as environment validation, service bootstrapping, deployment, and infrastructure management.

**Usage:**
```bash
npm run brat -- <command> [options]
```
*(Note: Use `--` to pass arguments through npm to the underlying script)*

### Global Flags
- `--env <name>`: Specify the environment (e.g., `dev`, `prod`). Can also be set via `BITBRAT_ENV`.
- `--project-id <id>`: Override the Google Cloud Project ID.
- `--region <name>`: Override the GCP region.
- `--dry-run`: Preview changes without applying them.
- `--json`: Output results in JSON format.

### Core Commands

#### Diagnostics & Config
- `brat doctor`: Run diagnostic checks to ensure required tools (`gcloud`, `terraform`, `docker`) are installed.
- `brat config show`: Display the resolved platform configuration.
- `brat config validate`: Validate `architecture.yaml` against the platform schema.

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

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Security

For security-related issues, please refer to [SECURITY.md](./SECURITY.md).
