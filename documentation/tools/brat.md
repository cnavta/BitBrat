# BitBrat Rapid Administration Tool (brat)

`brat` is the primary CLI tool for managing the BitBrat Platform. It simplifies common tasks such as environment validation, service bootstrapping, deployment, and infrastructure management.

## Installation

`brat` is included with the BitBrat Platform repository. To use it, ensure you have installed the project dependencies:

```bash
npm install
```

## Usage

You can run `brat` commands using `npm run brat`:

```bash
npm run brat -- <command> [options]
```

*(Note: Use `--` to pass arguments through npm to the underlying script)*

## Global Flags

- `--env <name>`: Specify the environment (e.g., `local`, `dev`, `prod`). Can also be set via `BITBRAT_ENV`.
- `--project-id <id>`: Override the Google Cloud Project ID.
- `--region <name>`: Override the GCP region.
- `--dry-run`: Preview changes without applying them.
- `--json`: Output results in JSON format.

## Core Commands

### Setup & Interaction

#### `brat setup`
Interactive platform initialization. Guides you through configuring your GCP Project ID, OpenAI API Key, and Bot Name.

```bash
npm run brat -- setup [--project-id <id>] [--openai-key <key>] [--bot-name <name>]
```

**What it does:**
- **Configuration**: Generates `.bitbrat.json`, `.secure.local`, and `env/local/global.yaml`.
- **Identity**: Sets up bot personalities and instructions in Firestore.
- **Rules**: Bootstraps the Event Router with default rules for core platform stages.
- **Security**: Creates an initial admin API token and stores its hash in Firestore.
- **Local Persistence**: Sets up the local environment to use the Firestore emulator and other local services.

#### `brat chat`
Start an interactive chat session with your bot. This is the primary tool for testing rules and interactions locally.

```bash
npm run brat -- chat [--env <name>] [--url <url>] [--project-id <id>]
```

**Features:**
- **Auto-Discovery**: In `local` environment, the tool automatically discovers the API Gateway port by querying Docker.
- **Authentication**: Requires an API token. It looks for `BITBRAT_API_TOKEN` environment variable or a `token` field in `.bitbrat.json` in the root directory.
- **Interactive Commands**:
    - `/help`: Show available terminal commands.
    - `/clear`: Clear the terminal screen.
    - `/exit` or `/quit`: End the chat session.

---

### Diagnostics & Config

#### `brat doctor`
Run diagnostic checks to ensure required tools (`gcloud`, `terraform`, `docker`) are installed and accessible. It also verifies your GCP authentication and project configuration.

```bash
npm run brat -- doctor [--json] [--ci]
```
- `--json`: Output the diagnostic report in JSON format.
- `--ci`: Run in non-interactive mode suitable for CI pipelines.

#### `brat config show`
Display the resolved platform configuration, including merged environment overlays.

```bash
npm run brat -- config show [--json]
```

#### `brat config validate`
Validate `architecture.yaml` against the platform schema.

```bash
npm run brat -- config validate [--json]
```

### Service Management

#### `brat service bootstrap`
Create a new service from a template. 

```bash
npm run brat -- service bootstrap --name <name> [--mcp] [--force]
```
- `--mcp`: Use the Model Context Protocol (MCP) server template.
- `--force`: Overwrite existing files.

### Deployment

#### `brat deploy services --all`
Deploy all services defined in `architecture.yaml` to the specified environment.

```bash
npm run brat -- deploy services --all --env <name> [--concurrency N] [--force]
```
- `--env`: Target environment (`local`, `dev`, `prod`).
- `--concurrency`: Number of simultaneous deployments (default: 3).
- `--force`: Ignore some safety checks during deployment.

#### `brat deploy service <name>`
Deploy a specific service.

```bash
npm run brat -- deploy service <name> --env <name>
```

### Infrastructure (IaC)

#### `brat infra plan <module>`
Generate an execution plan for infrastructure changes using Terraform (via CDKTF).

```bash
npm run brat -- infra plan network|lb|connectors|buckets --env <name>
```

#### `brat infra apply <module>`
Apply infrastructure changes.

```bash
npm run brat -- infra apply network|lb|connectors|buckets --env <name>
```

### Google Cloud Platform

#### `brat apis enable`
Enable all required Google Cloud APIs for the project.

```bash
npm run brat -- apis enable --env <name>
```

#### `brat cloud-run shutdown`
Stop all Cloud Run services in the environment to save costs. Sets min-instances to 0.

```bash
npm run brat -- cloud-run shutdown --env <name>
```
