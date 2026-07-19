# BitBrat Dev MCP Server - Tool Reference

Complete reference guide for all development tools exposed via the BitBrat MCP server.

## Overview

The BitBrat Dev MCP Server (`brat dev-mcp`) provides unified access to BitBrat development tooling across all deployment targets via the Model Context Protocol (MCP).

**Key Principles:**
- **Read-only** - All tools are read-only or dry-run (idempotent)
- **Fail-closed** - Requires authentication token to operate
- **Target-aware** - Works with local, staging, and production environments
- **Audit logging** - All tool invocations logged to `.brat/dev-mcp-audit.log`

## Quick Start

### Authentication

```bash
export MCP_DEV_TOKEN="your-token-here"
```

### Start Server

```bash
npm run brat -- dev-mcp start [--target <target>]
```

### Claude Code Configuration

Add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "bitbrat-dev": {
      "command": "npm",
      "args": ["run", "brat", "--", "dev-mcp", "start"],
      "env": {
        "MCP_DEV_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Available Tools (9 total)

### Configuration & Validation (4 tools)

#### `config.show`

Display the resolved BitBrat platform configuration.

**Signature:**
```typescript
config.show(args: {
  format?: "yaml" | "json"  // default: "yaml"
}): string
```

**Example:**
```typescript
await config.show({ format: "json" })
```

**Returns:** Full architecture.yaml content with environment overlays applied

**Use cases:**
- Inspect current platform configuration
- Verify service definitions before deployment
- Check environment variables and secrets (redacted)

---

#### `config.validate`

Validate architecture.yaml against the platform schema.

**Signature:**
```typescript
config.validate(args: {}): {
  valid: boolean;
  issues: Array<{level: "error" | "warning", message: string}>;
}
```

**Example:**
```typescript
await config.validate({})
```

**Validation Rules:**
- Required sections: name, project, services, messaging
- Profile/exposure contracts (mcp-server → platform+domain)
- Topic naming: `internal.<domain>.<verb>.v<N>`
- Active services have port defined

**Use cases:**
- Pre-deployment validation
- Detect configuration issues early
- Verify architecture changes comply with standards

---

#### `config.doctor`

Run environment diagnostics and prerequisite checks.

**Signature:**
```typescript
config.doctor(args: {}): {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Array<{name: string, status: "ok" | "warn" | "fail", message: string}>;
}
```

**Example:**
```typescript
await config.doctor({})
```

**Checks:**
- architecture.yaml exists and readable
- Node.js version (recommends 20+)
- Required directories (src, tools/brat, documentation, infrastructure)
- package.json present
- .brat directory writable

**Use cases:**
- Troubleshoot setup issues
- Verify development environment
- Pre-flight checks

---

#### `schema.read`

Read JSON schema definitions from documentation/schemas/.

**Signature:**
```typescript
schema.read(args: {
  name: string  // e.g., "envelope.v1", "routing-slip.v1"
}): object
```

**Example:**
```typescript
await schema.read({ name: "envelope.v1" })
```

**Available Schemas:**
- `envelope.v1` - Message envelope
- `routing-slip.v1` - Routing slip
- `architecture.v1` - Platform architecture
- `reflex-executed-event.v1` - Reflex execution event
- `reflex-failed-event.v1` - Reflex failure event

**Use cases:**
- Understand message formats
- Validate custom messages
- Reference platform schemas

---

### Fleet Management (2 tools)

#### `fleet.list`

Enumerate all live Bits in the fleet.

**Signature:**
```typescript
fleet.list(args: {}): {
  target: string;
  bits: Array<{
    name: string;
    profile: string;
    exposure: string;
    platformOnly: boolean;
  }>;
  count: number;
}
```

**Example:**
```typescript
await fleet.list({})
```

**Returns:** Metadata for all registered Bits

**Requirements:**
- Gateway URL configured in architecture.yaml
- Target environment must have active gateway

**Use cases:**
- Discover available services
- Inspect fleet composition
- Verify service registration

---

#### `fleet.info`

Get detailed information from specific Bit or all Bits.

**Signature:**
```typescript
fleet.info(args: {
  bit?: string  // omit for all Bits
}): {
  target: string;
  bit?: string;          // single Bit query
  info?: object;         // single Bit response
  bits?: Array<object>;  // all Bits query
  count?: number;
}
```

**Examples:**
```typescript
// Single Bit
await fleet.info({ bit: "auth" })

// All Bits (fan-out)
await fleet.info({})
```

**Bit Info Includes:**
- Version and uptime
- Process ID and memory usage
- Environment variables (secrets redacted)
- Capability metadata

**Use cases:**
- Inspect service health
- Debug configuration
- Monitor resource usage
- Verify deployment versions

**Requirements:** Gateway URL configured

---

### Persistence (3 tools)

#### `db.collections`

List all top-level database collections.

**Signature:**
```typescript
db.collections(args: {}): {
  collections: string[];
  count: number;
  projectId: string;
  databaseId: string;
}
```

**Example:**
```typescript
await db.collections({})
```

**Use cases:**
- Discover available collections
- Verify database structure
- Audit data organization

---

#### `db.get`

Get a database document by ID.

**Signature:**
```typescript
db.get(args: {
  collection: string;
  id: string;
}): {
  found: boolean;
  collection: string;
  id: string;
  data?: object;
}
```

**Example:**
```typescript
await db.get({ collection: "commands", id: "cmd-123" })
```

**Use cases:**
- Inspect specific documents
- Verify data integrity
- Debug application state
- Retrieve configuration

---

#### `db.query`

Query database with filters, ordering, and pagination.

**Signature:**
```typescript
db.query(args: {
  collection: string;
  filters?: Array<{
    field: string;
    op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains" | "array-contains-any";
    value: any;
  }>;
  orderBy?: {
    field: string;
    direction?: "asc" | "desc";  // default: "asc"
  };
  limit?: number;   // default: 50, max: 1000
  offset?: number;  // default: 0
}): {
  documents: Array<{id: string, data: object}>;
  count: number;
  collection: string;
  hasMore: boolean;
}
```

**Example:**
```typescript
await db.query({
  collection: "events",
  filters: [
    { field: "type", op: "==", value: "chat" },
    { field: "timestamp", op: ">", value: "2024-01-01T00:00:00Z" }
  ],
  orderBy: { field: "timestamp", direction: "desc" },
  limit: 10
})
```

**Performance:**
- Default limit: 50 documents
- Maximum limit: 1000 documents
- Use pagination for large result sets

**Use cases:**
- Search for specific events
- Analyze application data
- Debug user interactions
- Generate reports

---

## Target Awareness

All tools accept an optional `target` parameter:

```typescript
// Query production database
await db.get({ collection: "commands", id: "cmd-123", target: "production" })

// List staging fleet
await fleet.list({ target: "staging" })
```

**Available Targets:**
- `local` - Local Docker (database emulator)
- `staging` - Remote Docker (SSH)
- `production` - Cloud Run (Google Cloud)

Configuration in `architecture.yaml`:

```yaml
deploymentTargets:
  local:
    type: docker-engine
    host: unix:///var/run/docker.sock
  staging:
    type: docker-engine
    host: ssh://root@bitbrat.lan
    gateway:
      url: "http://gateway.staging:3000"
  production:
    type: gcp
    region: us-central1
    gateway:
      url: "https://gateway.bitbrat.ai"
```

---

## Security & Privacy

### Read-Only Guarantee

**No tool can mutate platform state:**
- Database: Only `get()`, `list()`, `query()` - no `add()`, `set()`, `update()`, `delete()`
- Filesystem: Only reads `architecture.yaml` and schemas
- Fleet: Only calls `bit.info` and similar read-only endpoints

**Enforcement:** Comprehensive test suite verifies no write operations

### Fail-Closed Security

**Authentication Required:**
- `MCP_DEV_TOKEN` or `MCP_AUTH_TOKEN` environment variable
- All tool calls fail without valid token
- No fallback or default credentials

**Example failure:**
```
Error: Authentication token required. Set MCP_DEV_TOKEN or MCP_AUTH_TOKEN.
```

### Secret Redaction

**Automatic redaction of sensitive data:**
- `config.show` - Redacts all secrets from output
- `fleet.info` - Server-side redacted configuration
- Audit log - Redacts tokens, passwords, keys

**Redaction keywords:**
- `token`, `password`, `secret`, `key`, `auth`, `credential`, `api_key`, `bearer`

**Example:**
```yaml
# Original
services:
  llm-bot:
    secrets:
      - OPENAI_API_KEY

# Redacted output
services:
  llm-bot:
    env:
      OPENAI_API_KEY: "***REDACTED***"
```

### Audit Logging

**All tool calls logged to `.brat/dev-mcp-audit.log`:**

```json
{
  "timestamp": "2024-01-15T12:00:00Z",
  "tool": "db.query",
  "args": {"collection": "events", "filters": [...]},
  "target": "local",
  "durationMs": 120,
  "success": true
}
```

**Privacy:** Arguments are redacted for sensitive data

---

## Example Workflows

### Workflow 1: Pre-Deployment Validation

```typescript
// 1. Check environment
const health = await config.doctor({});
console.log(`Environment: ${health.status}`);

// 2. Validate architecture
const validation = await config.validate({});
if (!validation.valid) {
  console.error("Validation failed:", validation.issues);
  return;
}

// 3. Inspect config
const config = await config.show({ format: "json" });
console.log("Services:", Object.keys(config.services));

// 4. Verify fleet
const fleet = await fleet.list({});
console.log(`Fleet size: ${fleet.count} Bits`);
```

### Workflow 2: Debug Service Issue

```typescript
// 1. List all services
const fleet = await fleet.list({});

// 2. Find problematic service
const targetBit = fleet.bits.find(b => b.name === "llm-bot");

// 3. Get detailed info
const info = await fleet.info({ bit: "llm-bot" });
console.log(`Uptime: ${info.uptime}s, Memory: ${info.memory.rss}`);

// 4. Check recent events
const events = await db.query({
  collection: "events",
  filters: [{ field: "source", op: "==", value: "llm-bot" }],
  orderBy: { field: "timestamp", direction: "desc" },
  limit: 20
});
console.log(`Recent events: ${events.count}`);
```

### Workflow 3: Data Analysis

```typescript
// 1. Query user events
const userEvents = await db.query({
  collection: "events",
  filters: [
    { field: "userId", op: "==", value: "user-123" },
    { field: "timestamp", op: ">", value: "2024-01-01T00:00:00Z" }
  ],
  orderBy: { field: "timestamp", direction: "asc" },
  limit: 100
});

// 2. Get user disposition
const disposition = await db.get({
  collection: "dispositions",
  id: "user-123"
});

// 3. Analyze command usage
const commands = await db.query({
  collection: "commands",
  filters: [{ field: "active", op: "==", value: true }]
});

console.log(`User events: ${userEvents.count}`);
console.log(`Disposition: ${disposition.data?.state}`);
console.log(`Active commands: ${commands.count}`);
```

---

## Troubleshooting

### Server won't start

**Error:** `Authentication token required`

**Solution:**
```bash
export MCP_DEV_TOKEN="your-token-here"
```

---

**Error:** `architecture.yaml not found`

**Solution:** Run from project root or ensure file exists in working directory

---

### Fleet tools failing

**Error:** `No gateway configured`

**Solution:** Add gateway URL to `architecture.yaml`:
```yaml
deploymentTargets:
  staging:
    gateway:
      url: "https://gateway.staging.bitbrat.ai"
```

---

### Database connection issues

**Local:**
- Ensure emulator running: `npm run local`
- Verify emulator port (default: 8080)

**Staging:**
- Verify SSH access
- Check remote Docker running

**Production:**
- Verify cloud credentials
- Check database API enabled (Firestore API for Google Cloud)

---

### Performance issues

**Solutions:**
- Reduce query `limit` parameter
- Add specific filters
- Use pagination
- Check network latency

---

## Tool Summary

| Tool | Category | Read-Only | Requires Gateway |
|------|----------|-----------|------------------|
| `config.show` | Config | ✅ | ❌ |
| `config.validate` | Config | ✅ | ❌ |
| `config.doctor` | Config | ✅ | ❌ |
| `schema.read` | Config | ✅ | ❌ |
| `fleet.list` | Fleet | ✅ | ✅ |
| `fleet.info` | Fleet | ✅ | ✅ |
| `db.collections` | Persistence | ✅ | ❌ |
| `db.get` | Persistence | ✅ | ❌ |
| `db.query` | Persistence | ✅ | ❌ |

---

## Further Reading

- **MCP Setup Guide:** `documentation/guides/mcp-setup.md`
- **Architecture Overview:** `documentation/concepts/bit-model.md`
- **Fleet Administration:** `documentation/guides/brat-fleet.md`
- **Platform Flow:** `documentation/concepts/platform-flow.md`

---

**Version:** 1.0.0
**Sprint:** 333 - Dev MCP Server Implementation
**Last Updated:** 2026-07-07
