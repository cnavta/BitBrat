# External Bit Integration – Technical Architecture

- **Date:** 2026-08-16
- **Status:** DRAFT – Architectural Proposal
- **Author:** Platform Architecture Team
- **Source of Truth:** `architecture.yaml` + Bit Model Technical Architecture
- **Related Systems:** MCP Server Discovery, Tool Gateway, Base Server (Bit), Docker Deployment

---

## 1. Executive Summary

BitBrat's **Bit model** (sprint-324) established a universal MCP control plane (`bit.*` tools) that every platform-native Bit exposes. However, **external container-based Bits** —pre-built Docker images from third-party MCP servers (e.g., `obs-mcp:latest`) — currently bypass this control plane entirely. They:

- ❌ Do **not** participate in dynamic service discovery via `INTERNAL_MCP_REGISTRATION_V1`
- ❌ Do **not** expose the mandatory `bit.*` platform control tools
- ❌ Do **not** publish health/readiness/config metadata in the platform's standard format
- ❌ **Cannot** be administered uniformly by Brat (no `bit.info`, `bit.health`, `bit.drain`)

This creates a **two-tier architecture**: first-class platform Bits (managed, observable) and second-class external Bits (opaque, manual).

**This document proposes a "warping" architecture** that wraps external container-based Bits in a thin **Adapter Sidecar** pattern, enabling them to participate in platform management without modifying upstream source code.

---

## 2. Problem Statement

### 2.1 Current State: External Bits

External Bits are defined in `architecture.yaml` with:

```yaml
services:
  obs-mcp:
    category: domain
    profile: mcp-server
    mcp:
      exposure: platform+domain
    active: true
    description: MCP server for controlling OBS
    kind: mcp-server
    external:
      - obs
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest  # <-- Pre-built image
    env:
      - MCP_TRANSPORT
      - OBS_WEBSOCKET_URL
      - OBS_WEBSOCKET_SELF_SIGNED
    secrets:
      - OBS_WEBSOCKET_PASSWORD
      - MCP_AUTH_TOKEN
```

**Deployment behavior:**

1. Docker/Cloud Run launches the pre-built image directly
2. Image may or may not extend BitBrat's `Bit` base class (typically it does not)
3. Service starts, but:
   - Does **not** call `publishRegistration()` → tool-gateway never discovers it
   - Does **not** register `bit.*` control tools → Brat cannot manage it
   - Health endpoints may not match `/healthz`, `/readyz`, `/livez` conventions

### 2.2 Gap Analysis

| Capability | Platform-Native Bit | External Container Bit | Gap |
|-----------|---------------------|------------------------|-----|
| **MCP discovery** | ✅ Publishes to `INTERNAL_MCP_REGISTRATION_V1` on start | ❌ No publication (manual config) | Auto-discovery broken |
| **Platform control tools** | ✅ `bit.info`, `bit.health`, `bit.config.*`, `bit.flags.*`, `bit.drain` | ❌ None | Cannot administer via Brat |
| **Health endpoints** | ✅ `/healthz`, `/readyz`, `/livez` | ⚠️ May have `/health` or custom | Non-uniform monitoring |
| **Lifecycle hooks** | ✅ `close(reason)`, signal handlers | ⚠️ May have SIGTERM handling | No graceful drain protocol |
| **Config/secrets** | ✅ `getConfig()`, `getSecret()`, architecture.yaml-driven | ⚠️ Environment variables only | No redaction, no runtime inspection |
| **Message bus integration** | ✅ `onMessage()`, `publish()` | ❌ No built-in support | Cannot participate in event orchestration |
| **Tracing/observability** | ✅ OpenTelemetry, structured logging | ⚠️ Varies by upstream | Non-uniform |

**Key insight:** External Bits are **capability-isolated** from the platform. They work as standalone MCP servers but cannot be fleet-managed.

### 2.3 Use Cases Requiring Integration

1. **Brat fleet commands** – `brat fleet info`, `brat fleet health`, `brat fleet drain` should work for ALL Bits (including obs-mcp)
2. **Dynamic tool discovery** – When obs-mcp starts/restarts, tool-gateway should auto-discover its tools without manual registration
3. **Runtime config inspection** – `bit.config.get` should work even if the underlying obs-mcp doesn't natively support it
4. **Graceful shutdown** – `bit.drain` should trigger graceful shutdown even for external Bits
5. **Health aggregation** – Platform health dashboards should include external Bits without custom scraping logic

---

## 3. Architectural Approaches

### 3.1 Approach A: Source Code Modification (Not Viable)

**Concept:** Fork/patch upstream obs-mcp (or other external MCP servers) to extend BitBrat's `Bit` base class.

**Pros:**
- Full platform integration
- Native implementation of all `bit.*` tools

**Cons:**
- ❌ **Not maintainable** – Must fork every external MCP server
- ❌ **Upstream drift** – Constant rebasing as upstream evolves
- ❌ **Against modularity** – Defeats the purpose of using external, pre-built MCP servers

**Verdict:** **Rejected** – Violates the platform's goal of consuming third-party MCP servers without modification.

---

### 3.2 Approach B: Adapter Sidecar Pattern (Recommended)

**Concept:** Deploy external Bits as **two-container pods** (Docker Compose, Kubernetes, Cloud Run with sidecars):

1. **Primary container:** The unmodified external MCP server (e.g., `obs-mcp:latest`)
2. **Sidecar container:** A thin BitBrat **Adapter Bit** that:
   - Extends `Bit` base class → gets all platform control plane features
   - Proxies domain MCP tools to the primary container
   - Publishes MCP registration on behalf of primary
   - Translates health checks
   - Exposes `bit.*` control tools

```
┌────────────────────────────────────────────────┐
│  Pod: obs-mcp                                  │
│  ┌──────────────────┐  ┌────────────────────┐ │
│  │  Sidecar:        │  │  Primary:          │ │
│  │  obs-adapter-bit │  │  obs-mcp:latest    │ │
│  │  (BitBrat Bit)   │  │  (External MCP)    │ │
│  │                  │  │                    │ │
│  │  • bit.* tools   │  │  • obs.* domain    │ │
│  │  • Publishes     │◄─┤    tools (SSE)     │ │
│  │    registration  │  │  • /health (custom)│ │
│  │  • /healthz      │  │                    │ │
│  │  • Proxy domain  │  └────────────────────┘ │
│  │    tools →       │         ▲               │
│  └──────────────────┘         │               │
│         ▲                     │               │
│         │                     │               │
│         └─────────────────────┘               │
│           Localhost network                   │
└────────────────────────────────────────────────┘
              ▲
              │
       External clients
    (tool-gateway, Brat)
     see unified surface
```

#### Design

**Sidecar responsibilities:**

1. **Platform Ring (bit.* tools)**
   - `bit.info` → Read from adapter's config (name, version, upstream URL)
   - `bit.health` / `bit.readiness` → Translate primary's `/health` or SSE health to platform format
   - `bit.config.get` → Return adapter-level config (proxy URL, upstream status)
   - `bit.drain` → Send graceful shutdown signal to primary (HTTP POST to custom endpoint or SIGTERM)

2. **MCP Registration**
   - On startup, publish `INTERNAL_MCP_REGISTRATION_V1` with:
     - `name: 'obs-mcp'`
     - `url: 'http://localhost:3000/sse'` (adapter's SSE endpoint)
     - `transport: 'sse'`
     - Context packs/bindings from upstream (if discoverable)

3. **MCP Proxy**
   - Adapter's `/sse` endpoint creates an upstream MCP client to primary container (`http://primary:3001/sse`)
   - `tools/list` → Fetch from primary + merge with `bit.*` tools
   - `tools/call` → If tool is `bit.*`, handle locally; else proxy to primary
   - Same for resources/prompts

4. **Health Translation**
   - Adapter's `/healthz` → Poll primary's `/health` (or SSE transport health)
   - Map `{ status: 'ok' }` → 200 OK, else 503

5. **Lifecycle Management**
   - Adapter's `bit.drain` → POST to primary's `/admin/drain` (if supported) or send SIGTERM
   - Adapter waits for primary to drain before exiting

**Pros:**
- ✅ **No upstream modification** – External MCP servers remain unmodified
- ✅ **Full platform integration** – Adapter is a native Bit with all control plane features
- ✅ **Uniform administration** – Brat sees adapter as first-class Bit
- ✅ **Reusable pattern** – One adapter implementation works for all external MCP servers
- ✅ **Deployment flexibility** – Works in Docker Compose, Kubernetes, Cloud Run multi-container deployments

**Cons:**
- ⚠️ **Additional resource overhead** – Two containers per external Bit
- ⚠️ **Complexity** – Multi-container orchestration (docker-compose, k8s sidecar, Cloud Run multi-container)
- ⚠️ **Latency** – MCP tool calls go through adapter proxy (localhost, minimal)

---

### 3.3 Approach C: Hybrid Wrapper (Single-Container Alternative)

**Concept:** Build a **custom Dockerfile** that:

1. Includes the external MCP server's binary/code as a **subprocess**
2. Wraps it in a thin Node.js BitBrat Bit that manages the subprocess

```
┌────────────────────────────────────┐
│  Container: obs-mcp-wrapped        │
│  ┌──────────────────────────────┐  │
│  │  Node.js Wrapper Bit         │  │
│  │  (extends Bit)               │  │
│  │                              │  │
│  │  • bit.* tools               │  │
│  │  • Publishes registration    │  │
│  │  • Spawns subprocess:        │  │
│  │    `node obs-mcp/index.js`   │  │
│  │  • Proxies MCP via stdio/SSE │  │
│  └──────────────────────────────┘  │
│         │                           │
│         ▼                           │
│  ┌──────────────────────────────┐  │
│  │  obs-mcp (subprocess)        │  │
│  │  • Runs as child process     │  │
│  │  • Communicates via stdio    │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

**Implementation:**

```typescript
// src/apps/obs-mcp-wrapper.ts
import { Bit } from '../common/base-server';
import { spawn, ChildProcess } from 'child_process';

export class ObsMcpWrapperBit extends Bit {
  private childProcess?: ChildProcess;

  constructor() {
    super({
      serviceName: 'obs-mcp',
      mcpExposure: 'platform+domain',
    });

    // Spawn the external obs-mcp as a subprocess
    this.childProcess = spawn('node', ['./external/obs-mcp/index.js'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'], // or 'inherit'
    });

    // Proxy MCP stdio transport to child process
    this.setupStdioProxy();
    this.registerPlatformTools();
  }

  private setupStdioProxy() {
    // If external MCP uses stdio transport, pipe stdin/stdout
    // If it uses SSE, create HTTP proxy to child's localhost port
  }

  private registerPlatformTools() {
    // bit.info, bit.health, bit.drain implemented here
    this.registerTool('bit.health', /* ... */, async () => {
      // Check if child process is alive
      return { alive: this.childProcess?.exitCode === null };
    });
  }

  async close(reason: string) {
    // Gracefully terminate child process
    this.childProcess?.kill('SIGTERM');
    await super.close(reason);
  }
}
```

**Pros:**
- ✅ **Single container** – Simpler deployment (no sidecar orchestration)
- ✅ **No upstream modification** – External MCP runs as subprocess
- ✅ **Platform integration** – Wrapper is a native Bit

**Cons:**
- ❌ **Custom Dockerfile per external Bit** – Must bundle external MCP into image
- ❌ **Subprocess management complexity** – Stdin/stdout piping, signal handling
- ❌ **Coupling** – Wrapper and external MCP versioned together
- ❌ **Less flexible** – Harder to swap external MCP versions independently

---

## 4. Recommended Approach: Adapter Sidecar (B)

**Recommendation:** Implement **Approach B (Adapter Sidecar)** for maximum modularity and reusability.

### 4.1 Rationale

1. **Separation of concerns** – Adapter handles platform integration; primary handles domain logic
2. **Upstream independence** – External MCP servers remain unmodified and independently versioned
3. **Reusable adapter** – One generic adapter implementation works for all external MCP servers
4. **Deployment maturity** – Docker Compose, Kubernetes, and Cloud Run all support multi-container deployments

### 4.2 Implementation Phases

#### Phase 1: Generic MCP Adapter Bit (Core)

**Deliverables:**
- New Bit: `MCP Adapter Bit` (`src/common/adapters/mcp-adapter-bit.ts`)
- Configurable via environment variables:
  - `ADAPTER_UPSTREAM_NAME` (e.g., `obs-mcp`)
  - `ADAPTER_UPSTREAM_URL` (e.g., `http://localhost:3001/sse`)
  - `ADAPTER_UPSTREAM_HEALTH_URL` (e.g., `http://localhost:3001/health`)
  - `ADAPTER_UPSTREAM_TRANSPORT` (`sse` | `stdio`)
- Platform tools:
  - `bit.info` → Return adapter config + upstream name
  - `bit.health` / `bit.readiness` → Poll upstream health URL
  - `bit.config.get` → Return adapter-level config
  - `bit.drain` → POST to `ADAPTER_UPSTREAM_DRAIN_URL` or send SIGTERM

**Implementation:**

```typescript
// src/common/adapters/mcp-adapter-bit.ts
import { Bit } from '../base-server';
import { McpClientManager } from '../mcp/client-manager';

export class McpAdapterBit extends Bit {
  private upstreamClient?: McpClientManager;

  constructor() {
    const upstreamName = process.env.ADAPTER_UPSTREAM_NAME || 'upstream';
    const upstreamUrl = process.env.ADAPTER_UPSTREAM_URL || 'http://localhost:3001/sse';

    super({
      serviceName: process.env.SERVICE_NAME || `${upstreamName}-adapter`,
      mcpExposure: 'platform+domain',
    });

    this.initializeUpstreamProxy(upstreamName, upstreamUrl);
    this.registerAdapterTools();
  }

  private async initializeUpstreamProxy(name: string, url: string) {
    // Create MCP client to upstream
    const config = {
      name,
      url,
      transport: 'sse' as const,
      authToken: process.env.MCP_AUTH_TOKEN,
    };

    this.upstreamClient = new McpClientManager(this as any, this.registry);
    await this.upstreamClient.connectServer(config);

    // Proxy discovered tools/resources/prompts from upstream
    this.proxyUpstreamTools();
  }

  private proxyUpstreamTools() {
    // Fetch tools from upstream and register them locally
    const upstreamTools = this.upstreamClient.getTools();
    for (const tool of upstreamTools) {
      this.registerTool(tool.name, tool.description, tool.inputSchema, async (args) => {
        // Proxy to upstream
        return await this.upstreamClient.callTool(tool.name, args);
      });
    }
  }

  private registerAdapterTools() {
    this.registerTool('bit.upstream.status', 'Check upstream MCP server status', {
      type: 'object',
      properties: {},
    }, async () => {
      const healthUrl = process.env.ADAPTER_UPSTREAM_HEALTH_URL;
      if (!healthUrl) {
        return { content: [{ type: 'text', text: 'No health URL configured' }] };
      }

      try {
        const response = await fetch(healthUrl);
        const data = await response.json();
        return {
          content: [{
            type: 'text',
            text: `Upstream health: ${JSON.stringify(data, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Upstream health check failed: ${error.message}`
          }],
          isError: true
        };
      }
    });
  }
}
```

#### Phase 2: Docker Compose Multi-Container Deployment

**Update `architecture.yaml` to support sidecar pattern:**

```yaml
services:
  obs-mcp:
    category: domain
    profile: mcp-server
    mcp:
      exposure: platform+domain
    active: true
    description: MCP server for controlling OBS
    kind: mcp-server

    # NEW: Sidecar deployment spec
    deployment:
      pattern: sidecar  # 'single' | 'sidecar'
      primary:
        image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
        port: 3001
        env:
          - OBS_WEBSOCKET_URL
          - OBS_WEBSOCKET_SELF_SIGNED
        secrets:
          - OBS_WEBSOCKET_PASSWORD
        healthEndpoint: /health
      adapter:
        entry: src/common/adapters/mcp-adapter-bit.ts
        port: 3000  # Adapter port (external-facing)
        env:
          - ADAPTER_UPSTREAM_NAME=obs-mcp
          - ADAPTER_UPSTREAM_URL=http://localhost:3001/sse
          - ADAPTER_UPSTREAM_HEALTH_URL=http://localhost:3001/health
          - ADAPTER_UPSTREAM_TRANSPORT=sse
```

**Generated `docker-compose.yml`:**

```yaml
services:
  obs-mcp-primary:
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
    ports:
      - "3001:3001"  # Internal only (or not exposed)
    environment:
      - OBS_WEBSOCKET_URL=${OBS_WEBSOCKET_URL}
      - OBS_WEBSOCKET_PASSWORD=${OBS_WEBSOCKET_PASSWORD}
    networks:
      - obs-mcp-pod

  obs-mcp-adapter:
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: obs-mcp-adapter
        SERVICE_ENTRY: dist/common/adapters/mcp-adapter-bit.js
        SERVICE_PORT: 3000
    ports:
      - "3000:3000"  # External-facing
    environment:
      - SERVICE_NAME=obs-mcp
      - ADAPTER_UPSTREAM_NAME=obs-mcp
      - ADAPTER_UPSTREAM_URL=http://obs-mcp-primary:3001/sse
      - ADAPTER_UPSTREAM_HEALTH_URL=http://obs-mcp-primary:3001/health
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
    depends_on:
      - obs-mcp-primary
    networks:
      - obs-mcp-pod
      - bitbrat-network

networks:
  obs-mcp-pod:
    driver: bridge
  bitbrat-network:
    external: true
```

**Benefits:**
- Adapter and primary share `obs-mcp-pod` network for localhost-like communication
- Only adapter is exposed on `bitbrat-network` (platform-facing)
- Primary can be replaced with any upstream image version

#### Phase 3: Cloud Run Multi-Container Deployment

**Cloud Run supports multi-container pods** (preview as of 2024, GA expected 2025+):

```yaml
# cloud-run-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: obs-mcp
spec:
  template:
    spec:
      containers:
      - name: adapter
        image: gcr.io/bitbrat/obs-mcp-adapter:latest
        ports:
          - containerPort: 3000
        env:
          - name: ADAPTER_UPSTREAM_URL
            value: http://localhost:3001/sse
          - name: ADAPTER_UPSTREAM_HEALTH_URL
            value: http://localhost:3001/health
      - name: primary
        image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
        ports:
          - containerPort: 3001
        env:
          - name: OBS_WEBSOCKET_URL
            valueFrom:
              secretKeyRef:
                name: obs-config
                key: websocket-url
```

**Fallback for non-multi-container environments:**
- Deploy adapter and primary as **two separate Cloud Run services**
- Adapter configured with `ADAPTER_UPSTREAM_URL=https://obs-mcp-primary-xxx.run.app/sse` (external URL)
- Less efficient (external HTTP hop) but works until multi-container support is stable

---

## 5. Adapter Contract & Configuration

### 5.1 Environment Variables (Adapter)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SERVICE_NAME` | Yes | Adapter's service name (matches architecture.yaml key) | `obs-mcp` |
| `ADAPTER_UPSTREAM_NAME` | Yes | Logical name of upstream MCP server | `obs-mcp` |
| `ADAPTER_UPSTREAM_URL` | Yes | Upstream MCP endpoint | `http://localhost:3001/sse` |
| `ADAPTER_UPSTREAM_TRANSPORT` | No | Transport type (default: `sse`) | `sse` \| `stdio` |
| `ADAPTER_UPSTREAM_HEALTH_URL` | No | Upstream health check endpoint | `http://localhost:3001/health` |
| `ADAPTER_UPSTREAM_DRAIN_URL` | No | Upstream graceful drain endpoint | `http://localhost:3001/admin/drain` |
| `MCP_AUTH_TOKEN` | Yes | Platform MCP auth token | `secret-token` |

### 5.2 Adapter Behavior

#### Startup Sequence

1. Adapter Bit starts, extends `Bit` base class
2. Waits for upstream to be healthy (retry with exponential backoff)
3. Connects to upstream as MCP client
4. Discovers upstream tools/resources/prompts
5. Registers discovered tools locally (proxying calls to upstream)
6. Publishes `INTERNAL_MCP_REGISTRATION_V1` with adapter's URL
7. Ready to serve requests

#### Health Check

- Adapter's `/healthz` returns 200 if:
  - Adapter process is healthy AND
  - Upstream health URL returns 2xx (if configured)
- Adapter's `/readyz` follows same logic

#### Tool Calls

- Request to adapter: `POST /message` (MCP JSON-RPC)
- If `method: 'tools/call'` and `params.name` matches `bit.*`:
  - Handle locally in adapter
- Else:
  - Proxy to upstream MCP client
  - Return upstream response

#### Graceful Shutdown

- `bit.drain` called on adapter:
  1. Adapter stops accepting new tool calls
  2. Waits for in-flight calls to complete (timeout: 30s)
  3. If `ADAPTER_UPSTREAM_DRAIN_URL` set, POST to upstream drain endpoint
  4. Else, send `SIGTERM` to upstream container (if co-located)
  5. Wait for upstream to exit (timeout: 30s)
  6. Adapter exits

---

## 6. Alternative: Stdio Transport Adaptation

Some external MCP servers use **stdio transport** instead of SSE. The adapter must support both.

### 6.1 Stdio Primary + SSE Adapter

**Scenario:** Upstream MCP server only supports stdio (common for Node.js MCP servers)

**Solution:** Adapter spawns upstream as a **subprocess** and bridges stdio ↔ SSE

```typescript
// src/common/adapters/mcp-adapter-bit.ts (stdio variant)
import { spawn, ChildProcess } from 'child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class McpAdapterBit extends Bit {
  private upstreamProcess?: ChildProcess;

  private async initializeUpstreamProxy() {
    const command = process.env.ADAPTER_UPSTREAM_COMMAND; // e.g., 'node'
    const args = process.env.ADAPTER_UPSTREAM_ARGS?.split(' '); // e.g., ['obs-mcp/index.js']

    this.upstreamProcess = spawn(command!, args!, {
      env: { ...process.env },
    });

    const transport = new StdioClientTransport({
      command: command!,
      args: args!,
    });

    // Connect MCP client via stdio
    await this.upstreamClient.connect(transport);

    // Now proxy as before
    this.proxyUpstreamTools();
  }
}
```

**Deployment:**

```yaml
services:
  obs-mcp-adapter:
    environment:
      - ADAPTER_UPSTREAM_TRANSPORT=stdio
      - ADAPTER_UPSTREAM_COMMAND=node
      - ADAPTER_UPSTREAM_ARGS=./external/obs-mcp/index.js
```

---

## 7. Migration Path

### 7.1 Backward Compatibility

- **Phase 1:** Adapter is **opt-in** via `deployment.pattern: sidecar` in `architecture.yaml`
- **Existing external Bits** (e.g., current `obs-mcp`) continue to work as-is (manual MCP registration)
- **New external Bits** can immediately use sidecar pattern

### 7.2 Migration Timeline

#### Sprint N: Core Adapter Implementation

- [ ] Implement `McpAdapterBit` base class
- [ ] Support SSE transport proxying
- [ ] Register platform `bit.*` tools
- [ ] Publish MCP registration on adapter startup
- [ ] Health translation (upstream `/health` → `/healthz`)

#### Sprint N+1: Docker Compose Integration

- [ ] Extend Brat deployment generator to support `deployment.pattern: sidecar`
- [ ] Generate multi-container docker-compose services
- [ ] Test with obs-mcp as pilot

#### Sprint N+2: Stdio Transport Support

- [ ] Add stdio subprocess spawning to adapter
- [ ] Bridge stdio ↔ SSE for adapter's external clients
- [ ] Test with stdio-based MCP server

#### Sprint N+3: Cloud Run Multi-Container

- [ ] Cloud Run multi-container deployment templates
- [ ] Fallback to separate services for non-multi-container environments
- [ ] Production rollout

---

## 8. Example: obs-mcp with Adapter

### 8.1 Before (Manual Registration)

**`architecture.yaml`:**

```yaml
services:
  obs-mcp:
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
    # No automatic MCP registration
```

**Manual step:**

```bash
# Developer must manually register obs-mcp in Firestore/Postgres mcp_servers table
brat mcp register obs-mcp \
  --url http://obs-mcp:3000/sse \
  --transport sse \
  --token $MCP_AUTH_TOKEN
```

**Result:**
- Tool-gateway discovers obs-mcp via manual registration
- Brat **cannot** call `bit.info`, `bit.health` (obs-mcp doesn't expose them)

### 8.2 After (Adapter Sidecar)

**`architecture.yaml`:**

```yaml
services:
  obs-mcp:
    deployment:
      pattern: sidecar
      primary:
        image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
        port: 3001
      adapter:
        entry: src/common/adapters/mcp-adapter-bit.ts
        port: 3000
        env:
          - ADAPTER_UPSTREAM_URL=http://localhost:3001/sse
```

**Automatic behavior:**

1. Brat deployment generates multi-container docker-compose service
2. On startup:
   - Primary (obs-mcp) starts on port 3001
   - Adapter starts on port 3000, connects to primary
   - Adapter publishes `INTERNAL_MCP_REGISTRATION_V1` → tool-gateway auto-discovers
3. External clients (tool-gateway, Brat) call adapter on port 3000
4. Adapter proxies domain tools (`obs.*`) to primary, handles platform tools (`bit.*`) locally

**Brat commands now work:**

```bash
brat fleet info
# Output includes:
# - obs-mcp (adapter):
#     status: active
#     upstream: http://localhost:3001/sse
#     tools: [bit.info, bit.health, obs.scene.switch, obs.source.toggle, ...]

brat fleet health obs-mcp
# Output:
# obs-mcp: healthy
#   adapter: ok
#   upstream: ok (http://localhost:3001/health)

brat fleet drain obs-mcp
# Adapter receives bit.drain, gracefully drains primary
```

---

## 9. Open Questions & Decisions

| Question | Options | Recommendation |
|----------|---------|----------------|
| **Adapter naming** | `{service}-adapter`, `mcp-adapter-{service}`, generic `mcp-adapter` | **`{service}-adapter`** – matches service name in architecture.yaml |
| **Upstream communication** | Localhost network, external URLs | **Localhost network** (Docker network, k8s pod) – lower latency |
| **Health check strategy** | Poll upstream, assume healthy, hybrid | **Poll upstream with caching** (cache 5s) |
| **Drain timeout** | 10s, 30s, 60s | **30s** – reasonable for most graceful shutdowns |
| **Stdio vs SSE default** | SSE default, stdio opt-in | **SSE default** – more common for modern MCP servers |
| **Multi-container deployment fallback** | Separate services, block deployment, error | **Separate services** – works everywhere, slight latency penalty |
| **Adapter resource limits** | Same as primary, fixed small limits | **Fixed small limits** (256MB RAM, 0.5 CPU) – adapter is lightweight |

---

## 10. Success Metrics

### 10.1 Functional Metrics

- [ ] `brat fleet info` includes all external Bits
- [ ] `brat fleet health {external-bit}` returns upstream health status
- [ ] `brat fleet drain {external-bit}` triggers graceful shutdown
- [ ] Tool-gateway auto-discovers external Bits on startup (no manual registration)
- [ ] External Bits expose all `bit.*` platform control tools

### 10.2 Performance Metrics

- [ ] Adapter MCP proxy latency: <10ms p50, <50ms p99 (localhost network)
- [ ] Adapter resource overhead: <256MB RAM, <0.5 CPU per adapter
- [ ] Upstream health check polling: <5s cached, <1s on demand

### 10.3 Operational Metrics

- [ ] Zero manual MCP registration steps for new external Bits
- [ ] 100% of external Bits participate in fleet health dashboards
- [ ] Adapter uptime >= primary uptime (adapter should not be the failure point)

---

## 11. Security Considerations

### 11.1 Adapter Attack Surface

**Risk:** Adapter exposes upstream MCP tools to external clients (tool-gateway, Brat)

**Mitigations:**
1. **MCP_AUTH_TOKEN required** – Adapter enforces same auth as platform Bits
2. **RBAC scopes** – Adapter can restrict which upstream tools are exposed based on scopes
3. **Upstream auth forwarding** – If upstream requires separate auth, adapter can inject credentials
4. **Network isolation** – Primary is only accessible to adapter (not exposed on platform network)

### 11.2 Upstream Trust Boundary

**Risk:** Malicious upstream MCP server could exploit adapter

**Mitigations:**
1. **Adapter input validation** – Validate upstream tool responses before proxying to clients
2. **Resource limits** – Limit upstream subprocess CPU/memory (Docker limits)
3. **Timeout enforcement** – Adapter enforces call timeouts even if upstream hangs
4. **Audit logging** – Adapter logs all tool calls (source, tool name, upstream response)

---

## 12. Alternative Considered: Direct Bit Extension

**Concept:** Require all external MCP servers to be repackaged as BitBrat Bits (extend `Bit` class).

**Rejected because:**
- Requires forking/modifying upstream source
- Defeats the goal of using pre-built, third-party MCP servers
- High maintenance burden (rebasing on upstream changes)

**The adapter pattern is superior because:**
- No upstream modification required
- Adapters are reusable across all external MCP servers
- Upstream servers can be swapped/upgraded independently

---

## 13. References

### 13.1 Existing Architecture

- `documentation/architecture/bit-model-technical-architecture.md` – Bit model, MCP control plane
- `architecture.yaml` – Service definitions, deployment configuration
- `src/common/base-server.ts` – Bit base class, MCP initialization
- `src/apps/tool-gateway.ts` – MCP registry, service discovery
- `src/common/mcp/registry-watcher.ts` – MCP registration watcher

### 13.2 External References

- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk) – MCP transports (SSE, stdio)
- [Docker Compose Multi-Container Services](https://docs.docker.com/compose/)
- [Cloud Run Multi-Container Deployments](https://cloud.google.com/run/docs/deploying#multicontainer)
- [Kubernetes Sidecar Pattern](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)

---

## 14. Appendix: Adapter API Specification

### 14.1 Required Platform Tools

Every adapter MUST expose:

```typescript
{
  name: 'bit.info',
  description: 'Get adapter and upstream server information',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        adapter: { name: 'obs-mcp-adapter', version: '1.0.0' },
        upstream: { name: 'obs-mcp', url: 'http://localhost:3001/sse', status: 'connected' },
      }, null, 2)
    }]
  })
}

{
  name: 'bit.health',
  description: 'Check adapter and upstream health',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const upstreamHealth = await fetch('http://localhost:3001/health');
    const upstreamData = await upstreamHealth.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          adapter: 'healthy',
          upstream: upstreamData.status,
        }, null, 2)
      }]
    };
  }
}

{
  name: 'bit.drain',
  description: 'Gracefully drain adapter and upstream',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    // Trigger upstream drain
    await fetch('http://localhost:3001/admin/drain', { method: 'POST' });
    // Wait for upstream to drain, then exit adapter
    setTimeout(() => process.exit(0), 30000);
    return { content: [{ type: 'text', text: 'Draining...' }] };
  }
}
```

### 14.2 MCP Registration Payload

Adapter publishes:

```typescript
{
  v: '2',
  type: 'internal.mcp.registration.v1',
  correlationId: 'uuid',
  payload: {
    name: 'obs-mcp',  // Service name (adapter represents upstream)
    url: 'http://obs-mcp-adapter:3000/sse',  // Adapter's external URL
    transport: 'sse',
    authToken: process.env.MCP_AUTH_TOKEN,
    status: 'active',
    discoverySource: 'auto-registration',
    contextPacks: [],  // Merged from upstream if discoverable
    contextBindings: [],
  }
}
```

---

## 15. Conclusion

The **Adapter Sidecar pattern** enables external container-based Bits to participate fully in BitBrat's platform management infrastructure **without requiring upstream source code modification**.

**Key benefits:**

✅ **Uniform administration** – All Bits (platform-native and external) expose `bit.*` control tools
✅ **Auto-discovery** – External Bits self-register via `INTERNAL_MCP_REGISTRATION_V1`
✅ **Modularity** – Adapters are reusable across all external MCP servers
✅ **Upstream independence** – External MCP servers remain unmodified, independently versionable
✅ **Deployment flexibility** – Works in Docker Compose, Kubernetes, Cloud Run multi-container

**Recommended next steps:**

1. Validate approach with stakeholders
2. Implement Phase 1 (Core Adapter Bit) with obs-mcp as pilot
3. Extend Brat deployment tooling to support `deployment.pattern: sidecar`
4. Document adapter configuration guidelines for new external Bits

---

**Document Status:** DRAFT – Ready for architectural review
**Reviewers:** Platform Team, DevOps, External Bit Maintainers
**Approval Gate:** Phase 1 implementation requires explicit approval before sprint start
