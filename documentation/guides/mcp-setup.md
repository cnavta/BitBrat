# BitBrat Dev MCP Server Setup

This guide explains how to set up the BitBrat dev MCP server for use with LLM agents like Claude Code.

## Overview

The `brat mcp setup` command configures the BitBrat dev MCP server in your Claude Code configuration, allowing LLM agents to interact with your BitBrat platform through MCP tools.

## Quick Start

```bash
# Setup with default settings (user scope, target local)
npm run brat -- mcp setup --target local

# Setup with custom options
npm run brat -- mcp setup \
  --target local \
  --scope user \
  --server-name bitbrat-dev \
  --log-level debug

# Dry-run to preview changes
npm run brat -- mcp setup --target local --dry-run
```

## Configuration Scopes

The `--scope` flag determines where the MCP server configuration is saved:

| Scope | Location | Access |
|-------|----------|--------|
| `user` (default) | `~/.claude.json` | All your projects globally |
| `project` | `.mcp.json` in project root | Team members who clone the repo |
| `local` | `~/.claude.json` | Current project only (project-specific section) |

## Command Options

- `--target <name>`: Target deployment (local, staging, prod). Default: none (uses .bitbrat.json)
- `--scope <scope>`: Config scope (local, user, project). Default: `user`
- `--server-name <name>`: MCP server name. Default: `bitbrat-dev`
- `--log-level <level>`: Log level (error, warn, info, debug). Default: `info`
- `--audit-log <path>`: Audit log path. Default: `.brat/dev-mcp-audit.log`
- `--dry-run`: Preview changes without writing config
- `--json`: Output result as JSON

## Authentication

The dev MCP server uses token-based authentication. Set the token in your environment:

```bash
# Set the authentication token
export MCP_DEV_TOKEN="test-token-123"

# Or use a custom token
export MCP_DEV_TOKEN="your-secure-token-here"
```

The configuration uses environment variable substitution with a default fallback:
```json
{
  "env": {
    "MCP_DEV_TOKEN": "${MCP_DEV_TOKEN:-test-token-123}"
  }
}
```

## Verifying Setup

After running `brat mcp setup`, verify the configuration:

```bash
# Check that the server is registered
claude mcp list

# Test the server directly
npm run brat -- dev-mcp start --target local
```

## Generated Configuration

The setup command creates an MCP server configuration like this:

```json
{
  "mcpServers": {
    "bitbrat-dev": {
      "type": "stdio",
      "command": "npm",
      "args": [
        "run",
        "brat",
        "--",
        "dev-mcp",
        "start",
        "--target",
        "local",
        "--log-level",
        "info"
      ],
      "env": {
        "MCP_DEV_TOKEN": "${MCP_DEV_TOKEN:-test-token-123}"
      }
    }
  }
}
```

## Available Tools

Once configured, the MCP server provides these tool categories:

1. **Config Tools**: Read and validate platform configuration
   - `brat.config.get`: Get configuration values
   - `brat.config.validate`: Validate architecture.yaml

2. **Persistence Tools**: Interact with the database
   - `brat.firestore.get`: Retrieve documents
   - `brat.firestore.query`: Query collections
   - `brat.firestore.set`: Write documents

3. **Fleet Tools** (when gateway is available):
   - `brat.fleet.list`: List all Bits
   - `brat.fleet.info`: Get Bit information
   - `brat.fleet.health`: Check Bit health

## Usage in Claude Code

Once set up, the MCP server is automatically available in Claude Code sessions:

```
User: Use the bitbrat-dev server to show me the current config

Claude: I'll use the brat.config.get tool to retrieve the configuration...
```

## Troubleshooting

### Server not listed
```bash
# Verify config file exists and is valid
cat ~/.claude.json | python3 -m json.tool

# Check for the bitbrat-dev entry in mcpServers
```

### Authentication errors
```bash
# Ensure MCP_DEV_TOKEN is set
echo $MCP_DEV_TOKEN

# Set it if missing
export MCP_DEV_TOKEN="test-token-123"
```

### Connection errors
```bash
# Test the server directly
npm run brat -- dev-mcp start --target local

# Check that the target exists in .bitbrat.json or architecture.yaml
cat .bitbrat.json
```

## Examples

### Setup for local development
```bash
npm run brat -- mcp setup --target local --log-level debug
```

### Setup for team (project scope)
```bash
npm run brat -- mcp setup --target local --scope project
```

### Setup with custom server name
```bash
npm run brat -- mcp setup \
  --target staging \
  --server-name bitbrat-staging \
  --scope user
```

### Preview without making changes
```bash
npm run brat -- mcp setup --target local --dry-run --json
```

## Security Notes

1. **Authentication**: Always use the MCP_DEV_TOKEN for authentication
2. **Audit Logging**: All tool calls are logged to `.brat/dev-mcp-audit.log`
3. **Fail-closed**: The server requires a valid auth token to start
4. **Scope**: Use `project` scope only for trusted team members

## See Also

- [Dev MCP Server Architecture](../concepts/dev-mcp-server.md)
- [MCP Tool Reference](../reference/dev-mcp-tools.md)
- [BitBrat CLI Reference](../reference/brat-cli.md)
