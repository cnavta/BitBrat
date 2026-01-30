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
Interactive platform initialization. Guides you through configuring your GCP Project ID, OpenAI API Key, and Bot Name. It also bootstraps your local environment using Docker.

```bash
npm run brat -- setup [--project-id <id>] [--openai-key <key>] [--bot-name <name>]
```

#### `brat chat`
Start an interactive chat session with your bot.

```bash
npm run brat -- chat [--env <name>] [--url <url>]
```

### Diagnostics & Config

#### `brat doctor`
Run diagnostic checks to ensure required tools (`gcloud`, `terraform`, `docker`) are installed and accessible.

```bash
npm run brat -- doctor [--json] [--ci]
```

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
npm run brat -- deploy services --all --env <name> [--concurrency N]
```

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
