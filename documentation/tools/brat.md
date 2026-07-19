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
- `--project-id <id>`: Override the cloud project ID.
- `--region <name>`: Override the cloud region.
- `--dry-run`: Preview changes without applying them.
- `--json`: Output results in JSON format.

## Core Commands

### Setup & Interaction

#### `brat setup`
Interactive platform initialization. Guides you through configuring your cloud project ID, OpenAI API Key, and Bot Name.

```bash
npm run brat -- setup [--project-id <id>] [--openai-key <key>] [--bot-name <name>]
```

**What it does:**
- **Configuration**: Generates `.bitbrat.json`, `.secure.local`, and `env/local/global.yaml`.
- **Identity**: Sets up bot personalities and instructions in the database.
- **Rules**: Bootstraps the Event Router with default rules for core platform stages.
- **Security**: Creates an initial admin API token and stores its hash in the database.
- **Local Persistence**: Sets up the local environment to use the database emulator and other local services.

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

#### `brat code`
Launch a coding agent with BitBrat project context automatically configured. This command auto-detects installed coding agents, configures them with full project context, and provides an AI-assisted codebase exploration experience.

```bash
npm run brat -- code [options]
```

**Features:**
- **Auto-Detection**: Automatically discovers installed coding agents on your system
- **Zero-Config**: Injects BitBrat context (CLAUDE.md, architecture.yaml, AGENTS.md, README.md) without manual setup
- **MCP Integration** (Claude Code only): Auto-discovers and configures MCP servers from your local environment
- **Preference Persistence**: Remembers your preferred agent in `~/.bratrc`
- **First-Run Welcome**: On first use, automatically provides an interactive introduction to BitBrat
- **Pass-Through Flags**: Forward arguments to the underlying agent

**Options:**
- `--list`, `-l`: List all detected coding agents with versions
- `--agent <name>`, `-a <name>`: Launch a specific agent (claude-code, aider, continue, openhands)
- `--project-root <path>`, `-p <path>`: Override the project root directory (default: auto-detected)

**Examples:**

```bash
# Interactive: Select from detected agents
npm run brat -- code

# List all installed agents
npm run brat -- code --list

# Launch Claude Code specifically
npm run brat -- code --agent claude-code

# Launch Aider
npm run brat -- code --agent aider

# Pass flags to the agent (e.g., use opus model)
npm run brat -- code -- --model opus

# Use different project root
npm run brat -- code --project-root /path/to/project
```

**Supported Agents:**

| Agent | Installation | Features |
|-------|--------------|----------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | Full MCP auto-configuration, stdio proxy, tool discovery |
| **Aider** | `pip install aider-chat` | Context injection via `--read` flags |
| **Continue** | `npm install -g continue` | Config file generation |
| **OpenHands** | `pip install openhands` | Environment-based configuration |

**Preference File (~/.bratrc):**

After first use, your preferred agent is saved:

```yaml
version: 1
codingAgent:
  preferred: claude-code
  plugins:
    claude-code:
      model: claude-sonnet-4.5
```

**MCP Auto-Configuration (Claude Code):**

For Claude Code, `brat code` automatically:
1. Detects running MCP servers (via Docker or tool-gateway)
2. Configures `mcpServers` block in `.claude/config.json`
3. Sets up authentication tokens
4. Enumerates available tools

Example generated config:

```json
{
  "mcpServers": {
    "bitbrat-tool-gateway": {
      "command": "node",
      "args": ["/path/to/mcp-stdio-proxy.js"],
      "env": {
        "MCP_AUTH_TOKEN": "..."
      }
    }
  }
}
```

**Troubleshooting:**

*Agent not detected:*
- Ensure the agent is installed (see installation commands above)
- Verify it's in your PATH: `which claude` or `which aider`
- Check version compatibility: `claude --version`

*MCP connection failed (Claude Code):*
- Ensure tool-gateway is running: `npm run local`
- Check `MCP_AUTH_TOKEN` environment variable is set
- Verify Docker is running for local development

*Preference file errors:*
- Delete corrupted file: `rm ~/.bratrc`
- File will be regenerated on next run
- Check YAML syntax if editing manually

**See Also:**
- [Coding with brat code](../guides/coding-with-brat-code.md) - Comprehensive guide
- [Coding Agent Plugins](../guides/coding-agent-plugins.md) - Plugin development guide

---

### Diagnostics & Config

#### `brat doctor`
Run diagnostic checks to ensure required tools (`gcloud`, `terraform`, `docker`) are installed and accessible. It also verifies your cloud authentication and project configuration.

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
Scaffold a new **[Bit](../concepts/bit-model.md)** from a template. Every Bit serves the universal
`bit.*` control plane out of the box; `--mcp` additionally scaffolds domain tools.

```bash
npm run brat -- service bootstrap --name <name> [--mcp] [--force]
```
- `--mcp`: Also scaffold domain tools served over MCP (`mcp.exposure: platform+domain`).
- `--force`: Overwrite existing files.

### Deployment

#### `brat deploy services --all`
Deploy all services defined in `architecture.yaml` to the specified environment. Services marked
`active: false` (or with no `active` flag — disabled by default per `defaults.services.active`) are
**skipped** with a `deploy.service status=skipped reason=inactive` log, matching the IaC synth path.

```bash
npm run brat -- deploy services --all --env <name> [--concurrency N] [--force]
```
- `--env`: Target environment (`local`, `dev`, `prod`).
- `--concurrency`: Number of simultaneous deployments (default: 3).
- `--force`: Ignore some safety checks during deployment.

> Deploying an inactive service **by name** fails fast with a `ConfigurationError` (set `active: true`
> in `architecture.yaml` to enable it) rather than silently deploying or skipping it.

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

### Cloud Platform

#### `brat apis enable`
Enable all required cloud APIs for the project (Google Cloud).

```bash
npm run brat -- apis enable --env <name>
```

#### `brat cloud-run shutdown`
Stop all Cloud Run services in the environment to save costs. Sets min-instances to 0.

```bash
npm run brat -- cloud-run shutdown --env <name>
```

### Fleet Control Plane

#### `brat fleet`
Drive the universal [`bit.*` control plane](../reference/bit-control-plane.md) across the fleet. Brat acts
as a **fleet MCP client**: by default it routes through the `tool-gateway` fabric (one auth/RBAC/discovery
chokepoint), with an audited `--direct <bit>` break-glass path for emergencies. Read subcommands require
the `bit:read` scope; mutating subcommands require `bit:operate`. RBAC is server-authoritative — Brat only
forwards identity and never self-authorizes. See the [`brat fleet` guide](../guides/brat-fleet.md) for the
full operations walkthrough.

```bash
npm run brat -- fleet <subcommand> [<bit> | --all] [options]
```

**Subcommands:**
- `fleet list`: Enumerate live Bits (name, profile, exposure).
- `fleet info [<bit> | --all]`: `bit.info`.
- `fleet health [<bit> | --all]`: `bit.health`.
- `fleet config <bit> [--describe]`: `bit.config.get` / `bit.config.describe` (secrets redacted).
- `fleet flags <bit> get [--key K]`: `bit.flags.get`.
- `fleet flags <bit> set --key K --value V`: `bit.flags.set` (elevated).
- `fleet log <bit> --level <error|warn|info|debug>`: `bit.log.level` (elevated).
- `fleet drain <bit> [--confirm]`: `bit.drain` (elevated).
- `fleet shutdown <bit> [--confirm]`: `bit.shutdown` (elevated).
- `fleet restart <bit> [--confirm]`: `bit.restart` — graceful close then exit so the orchestrator respawns a fresh instance (elevated).

**Modifiers:**
- `--all`: Fan out across every discovered Bit (READ-only; fleet-wide mutations require `--confirm`).
- `--direct <bit>`: **Break-glass** — bypass the gateway and connect directly to one Bit (audited; never with `--all`).
- `--confirm`: Required for fleet-wide / high-blast-radius mutations.
- `--json`: Machine-readable output.
- `--target <name>`: Select a docker deployment target (e.g. `local` | `staging`); reads that stack's database emulator registry instead of cloud database.
- `--env <name>`: Select environment (reuses the global flag + `BITBRAT_ENV`).

> Commands fail closed: without a resolvable `MCP_AUTH_TOKEN` they refuse to run.

### Versioning & Releases

#### `brat release`
Cut a platform version. `architecture.yaml` `project.version` is the **single source of truth**;
`package.json` and `package-lock.json` mirror it. `brat release` bumps all three in lockstep, asserts they
agree, and rolls `CHANGELOG.md` `## [Unreleased]` into a dated block. The bump type is always an explicit
argument (never guessed; pre-1.0 SemVer).

```bash
npm run brat -- release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--yes]
```
- `patch|minor|major|x.y.z`: Explicit bump (`major` is an explicit `0.x -> 1.0.0`).
- `--dry-run`: Compute and report the planned changes; write **nothing** (CI-safe).
- `--tag`: Also create a local `git tag v<version>` (never pushes). Off by default.
- `--yes`: Skip the interactive confirmation prompt (non-interactive / CI use).

**npm aliases** (note the `--` to pass args through npm):
```bash
npm run release -- <bump>        # e.g. npm run release -- patch
npm run release:dry -- <bump>    # idempotent, CI-safe; wired into validate_deliverable.sh
```
