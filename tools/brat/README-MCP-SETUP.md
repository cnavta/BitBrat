# MCP Setup Command

Quick reference for setting up the BitBrat dev MCP server with Claude Code and other LLM agents.

## TL;DR

```bash
# One-command setup (recommended for most users)
npm run brat -- mcp setup --target local

# Verify it worked
claude mcp list
```

## What This Does

The `brat mcp setup` command automatically configures Claude Code (or other MCP-compatible agents) to use the BitBrat development MCP server. This allows you to:

- Query and modify platform configuration
- Interact with Firestore data
- Manage the BitBrat fleet through MCP tools
- Access all `brat` CLI functionality through natural language

## Quick Examples

```bash
# Setup for local development (most common)
npm run brat -- mcp setup --target local

# Setup for staging environment
npm run brat -- mcp setup --target staging --server-name bitbrat-staging

# Preview changes without writing
npm run brat -- mcp setup --target local --dry-run

# Setup for project team (commits .mcp.json to repo)
npm run brat -- mcp setup --target local --scope project

# Setup with debug logging
npm run brat -- mcp setup --target local --log-level debug
```

## Configuration Scopes

### User Scope (Default)
```bash
npm run brat -- mcp setup --scope user
```
- Config saved to: `~/.claude.json`
- Available in: All your projects globally
- Use when: You want the server available everywhere

### Project Scope
```bash
npm run brat -- mcp setup --scope project
```
- Config saved to: `.mcp.json` in project root
- Available to: Team members who clone the repo
- Use when: Sharing with team (can commit to git)

## Authentication

Set the authentication token before using:

```bash
# Set environment variable
export MCP_DEV_TOKEN="test-token-123"

# Or use a secure token
export MCP_DEV_TOKEN="$(cat ~/.bitbrat-token)"
```

The config uses this with a fallback:
```bash
${MCP_DEV_TOKEN:-test-token-123}
```

## Usage in Claude Code

Once set up, the MCP server is automatically available:

```
You: Show me the current BitBrat configuration

Claude: I'll use the bitbrat-dev MCP server to fetch the configuration...
[Uses brat.config.get tool automatically]
```

## Available Tools

Once configured, these tools are available through MCP:

### Config Tools
- `brat.config.get` - Get configuration values
- `brat.config.validate` - Validate architecture.yaml

### Persistence Tools
- `brat.firestore.get` - Get documents from Firestore
- `brat.firestore.query` - Query Firestore collections
- `brat.firestore.set` - Write documents to Firestore

### Fleet Tools (when gateway available)
- `brat.fleet.list` - List all running Bits
- `brat.fleet.info` - Get Bit information
- `brat.fleet.health` - Check Bit health status

## Verification

After setup, verify everything works:

```bash
# 1. Check Claude sees the server
claude mcp list

# 2. Test the server directly
npm run brat -- dev-mcp start --target local

# 3. Use it in a Claude session
claude
> Use the bitbrat-dev server to show platform info
```

## Troubleshooting

### Server not showing up
```bash
# Check config file
cat ~/.claude.json | grep -A 10 bitbrat-dev

# Re-run setup
npm run brat -- mcp setup --target local
```

### Auth errors
```bash
# Verify token is set
echo $MCP_DEV_TOKEN

# Set if missing
export MCP_DEV_TOKEN="test-token-123"
```

### Target not found
```bash
# Check .bitbrat.json exists
cat .bitbrat.json

# Or run setup without --target
npm run brat -- mcp setup
```

## Full Options Reference

```
--target <name>         Target deployment (local, staging, prod)
--scope <scope>         Where to save config (local, user, project)
--server-name <name>    MCP server name (default: bitbrat-dev)
--log-level <level>     Log level (error, warn, info, debug)
--audit-log <path>      Audit log path (default: .brat/dev-mcp-audit.log)
--dry-run              Preview without writing files
--json                 Output result as JSON
```

## See Also

- [Full MCP Setup Guide](../../documentation/guides/mcp-setup.md)
- [Dev MCP Server Documentation](../../documentation/concepts/dev-mcp-server.md)
- [BitBrat CLI Reference](../../documentation/reference/brat-cli.md)
