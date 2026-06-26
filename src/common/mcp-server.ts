import { BaseServer, BaseServerOptions, McpExposure } from "./base-server";

/**
 * McpServer (Bit model, sprint-324)
 *
 * @deprecated `McpServer` is now a thin compatibility shim over {@link Bit}. The MCP control plane
 * (SSE transport, tool/resource/prompt registration, discovery handlers, RBAC/token auth, and
 * registry self-publish) has been folded down into `Bit` itself. This shim simply selects
 * `platform+domain` MCP exposure so that existing `extends McpServer` services keep their full
 * MCP server behavior unchanged.
 *
 * New code should `extend Bit` and declare `mcp.exposure` in architecture.yaml instead of
 * extending `McpServer`.
 */
export class McpServer extends BaseServer {
  constructor(opts: BaseServerOptions = {}) {
    const mcpExposure: McpExposure = opts.mcpExposure ?? "platform+domain";
    super({ ...opts, mcpExposure });
  }
}

// Re-export the base options/type for back-compat with modules that imported them from here.
export type { BaseServerOptions, McpExposure } from "./base-server";
export { Bit } from "./base-server";
