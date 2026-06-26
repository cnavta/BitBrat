import type { Bit } from '../base-server';
import { BitProfile } from './types';
import { IToolRegistry } from '../../types/tools';
import { McpClientManager } from '../mcp/client-manager';
import { RegistryWatcher } from '../mcp/registry-watcher';
import { McpServerConfig } from '../mcp/types';

/**
 * The MCP-client capability attached to a Bit by {@link McpClientProfile}, exposed as `bit.mcpClient`.
 */
export interface McpClientCapability {
  /** The shared tool registry (used both by the manager to register discovered tools and by the loop). */
  readonly registry: IToolRegistry;
  /** The MCP client manager wiring discovered MCP servers' tools into the registry. */
  readonly manager: McpClientManager;
  /** Connect to the tool-gateway fabric (with retry) or, absent a gateway URL, watch the registry. */
  connect(): Promise<void>;
  /** Tear down the registry watcher and client manager. */
  shutdown(): Promise<void>;
}

export interface McpClientProfileOptions {
  /**
   * Factory for the per-instance tool registry. The same instance is shared with the manager (tool
   * registration) and the consuming Bit (tool execution loop). Injected so this common profile stays
   * decoupled from any domain-specific registry implementation.
   */
  createRegistry: () => IToolRegistry;
  /** Env var holding the tool-gateway SSE URL. Default: 'MCP_GATEWAY_URL'. */
  gatewayUrlEnv?: string;
}

/**
 * McpClientProfile (Bit model, sprint-324, Phase 2).
 *
 * Absorbs the `McpClientManager` + `RegistryWatcher` choreography previously hand-rolled in `llm-bot`:
 *  - on startup, connect to the tool-gateway fabric (with bounded retry/backoff) when `MCP_GATEWAY_URL`
 *    is set, otherwise watch the Firestore MCP registry and connect/disconnect servers as they change;
 *  - on shutdown, stop the watcher and shut the manager down.
 *
 * The capability is exposed as `bit.mcpClient` so the Bit can register internal tools into the shared
 * registry and inspect connection stats. Behavior is preserved across deployment targets: the gateway
 * URL / bus backend are read from config, with no GCP-only or Compose-only assumptions.
 */
export function McpClientProfile(opts: McpClientProfileOptions): BitProfile {
  const gatewayUrlEnv = opts.gatewayUrlEnv || 'MCP_GATEWAY_URL';

  return {
    name: 'mcp-client',
    install(bit: Bit): void {
      const anyBit = bit as any;
      const registry = opts.createRegistry();
      const manager = new McpClientManager(bit as any, registry);
      let watcher: RegistryWatcher | undefined;

      const connect = async (): Promise<void> => {
        const gatewayUrl = bit.getConfig<string>(gatewayUrlEnv, { required: false });
        if (gatewayUrl) {
          bit.getLogger().info('bit.mcp_client.connecting_gateway', { url: gatewayUrl });
          const cfg: McpServerConfig = {
            name: 'tool-gateway',
            transport: 'sse',
            url: gatewayUrl,
            env: {
              'x-mcp-token': process.env.MCP_AUTH_TOKEN || '',
              'x-agent-name': (bit as any).serviceName,
            },
          };

          // Retry loop to handle race conditions where the gateway container isn't ready yet.
          const maxAttempts = parseInt(process.env.MCP_GATEWAY_CONNECT_RETRIES || '10', 10);
          const initialBackoffMs = parseInt(process.env.MCP_GATEWAY_CONNECT_BACKOFF_MS || '1000', 10);
          let backoff = isFinite(initialBackoffMs) ? Math.max(100, initialBackoffMs) : 1000;
          for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
            await manager.connectServer(cfg);
            const status = manager.getStats().getServerStats('tool-gateway')?.status;
            if (status === 'connected') {
              bit.getLogger().info('bit.mcp_client.gateway_connected', { attempt });
              break;
            }
            if (attempt === maxAttempts) {
              bit.getLogger().error('bit.mcp_client.gateway_connect_failed', { attempts: maxAttempts, url: gatewayUrl });
              break;
            }
            bit.getLogger().warn('bit.mcp_client.gateway_connect_retry', { attempt, backoffMs: backoff });
            await new Promise((r) => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, 15000);
          }
        } else {
          watcher = new RegistryWatcher(bit as any, {
            onServerActive: async (config) => {
              await manager.connectServer(config);
            },
            onServerInactive: async (name) => {
              await manager.disconnectServer(name);
            },
          });
          watcher.start();
        }
      };

      const shutdown = async (): Promise<void> => {
        if (watcher) {
          watcher.stop();
          watcher = undefined;
        }
        await manager.shutdown();
      };

      const capability: McpClientCapability = { registry, manager, connect, shutdown };
      anyBit.mcpClient = capability;

      bit.onStartup(async () => { await connect(); });
      bit.onShutdown(async () => { await shutdown(); });

      bit.getLogger().debug('bit.mcp_client.installed');
    },
  };
}
