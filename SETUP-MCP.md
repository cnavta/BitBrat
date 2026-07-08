# BitBrat MCP Setup - Quick Start

Set up the BitBrat dev MCP server for use with Claude Code and other LLM agents in under 1 minute.

## Quick Setup

```bash
# 1. Run setup command
npm run brat -- mcp setup --target local

# 2. Set authentication token
export MCP_DEV_TOKEN="test-token-123"

# 3. Verify
claude mcp list
```

That's it! The `bitbrat-dev` MCP server is now available in all your Claude Code sessions.

## What You Get

Once configured, you can use natural language to:

- **Query Configuration**: "Show me the current BitBrat config"
- **Manage Firestore**: "List all commands in the Firestore commands collection"
- **Fleet Operations**: "Get health status of all running Bits"
- **Validate Settings**: "Check if architecture.yaml is valid"

## Usage Example

```
You: Use bitbrat-dev to show me the platform configuration

Claude: I'll fetch the BitBrat configuration using the MCP server...
[Automatically calls brat.config.get tool]

Here's the current configuration:
- Project ID: twitch-452523
- Environment: local
- Services: 12 active services
...
```

## How It Works

The setup command:

1. ✅ Adds MCP server config to `~/.claude.json`
2. ✅ Configures stdio transport using `npm run brat -- dev-mcp start`
3. ✅ Sets up authentication via environment variable
4. ✅ Enables all dev MCP tools (config, persistence, fleet)

## Verify Setup

```bash
# Check Claude sees the server
claude mcp list

# Test the server directly
npm run brat -- dev-mcp start --target local

# View the configuration
cat ~/.claude.json | grep -A 15 bitbrat-dev
```

## Next Steps

- 📖 [Full MCP Setup Guide](./documentation/guides/mcp-setup.md)
- 🛠️ [Quick Reference](./tools/brat/README-MCP-SETUP.md)
- 🔧 [Dev MCP Tools Reference](./documentation/reference/dev-mcp-tools.md)

## Troubleshooting

**Server not showing up?**
```bash
npm run brat -- mcp setup --target local  # Re-run setup
```

**Auth errors?**
```bash
export MCP_DEV_TOKEN="test-token-123"  # Set token
```

**Need different environment?**
```bash
npm run brat -- mcp setup --target staging  # Use staging
```

## Advanced Options

```bash
# Project scope (share with team)
npm run brat -- mcp setup --scope project --target local

# Custom server name
npm run brat -- mcp setup --server-name my-bitbrat --target local

# Debug logging
npm run brat -- mcp setup --target local --log-level debug

# Preview changes
npm run brat -- mcp setup --target local --dry-run
```

---

**Quick Links:**
- [Main README](./README.md)
- [BitBrat CLI](./tools/brat/README.md)
- [Architecture](./documentation/concepts/platform-flow.md)
