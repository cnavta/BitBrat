import type { Bit } from '../base-server';
import { BitProfile } from './types';
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/server";
import { getLlmProvider, LlmProviderConfig } from '../llm/provider-factory';
import { assemble } from '../prompt-assembly/assemble';
import { redactText } from '../prompt-assembly/redaction';
import type { PromptSpec, AssemblerConfig } from '../prompt-assembly/types';
import { jsonSchema } from 'ai';
import type { BitBratTool } from '../../types/tools';

/**
 * Memory / behavioral-guidance knobs surfaced as LlmProfile config (previously buried in llm-bot's
 * CONFIG_DEFAULTS). Read from the Bit's config so every LLM Bit exposes them identically.
 */
export interface LlmConfigKnobs {
  memory: { maxMessages?: number; maxChars?: number };
  behavioralGuidance: { enabled?: boolean; toolFilterEnabled?: boolean; gatingEnabled?: boolean };
}

/**
 * The LLM capability attached to a Bit by {@link LlmProfile}, exposed as `bit.llm`.
 */
export interface LlmCapability {
  /** Effective active provider+model (in-memory override wins over config/env). */
  getModel(): { provider: string; model: string };
  /** Override the active provider and/or model in memory; returns the new effective value. */
  setModel(next: { provider?: string; model?: string }): { provider: string; model: string };
  /** Resolve a concrete provider instance via the shared provider-factory. */
  resolveProvider(kind?: 'language' | 'embedding'): unknown;
  /** Memory / behavioral-guidance knobs read from config. */
  getConfigKnobs(): LlmConfigKnobs;
  /** Tool-exposure filter applied to the discovered MCP tool set. */
  toolFilter: { mode: 'off' | 'allow' | 'deny'; list: string[] };
  /**
   * Prepare tools for LLM usage by injecting missing schemas from PostgreSQL tool registry.
   *
   * This method automatically fetches schemas for PostgreSQL-registered tools that arrive
   * without schemas (due to MCP SDK v2 transport limitations). It queries the tool registry,
   * extracts schemas, and wraps them in AI SDK's jsonSchema() format.
   *
   * @param tools - Tools from registry.getTools() (may have undefined inputSchema)
   * @returns Tools with schemas injected (ready for AI SDK)
   * @since Sprint 66
   */
  prepareToolsForLlm(tools: Record<string, BitBratTool>): Promise<Record<string, any>>;
}

const READ = ['bit:read'];
const OPERATE = ['bit:operate'];

function num(bit: Bit, key: string): number | undefined {
  const v = bit.getConfig<number>(key, { required: false, parser: (s) => parseInt(String(s), 10) });
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function bool(bit: Bit, key: string): boolean | undefined {
  const v = bit.getConfig<string>(key, { required: false });
  if (v === undefined) return undefined;
  return String(v) === 'true';
}

/**
 * LlmProfile (the "LlmBit" capability — Bit model, sprint-324, Phase 2).
 *
 * Bundles, over {@link Bit}, the scaffolding that `llm-bot`, `query-analyzer`, and `stream-analyst`
 * each previously re-implemented:
 *  - **Provider resolution** via `common/llm/provider-factory` (LLM_PROVIDER / LLM_MODEL / keys).
 *  - **Prompt assembly + redaction** via `common/prompt-assembly`.
 *  - **LLM-admin platform tools** (`bit.llm.model`, `bit.llm.promptPreview`, `bit.llm.toolFilter`) so
 *    Brat can inspect/tune any LLM Bit identically. These are namespaced under `bit.*` deliberately:
 *    they are platform-level admin of an LLM capability, distinct from a Bit's domain tools, and are
 *    RBAC-scoped.
 *  - **Memory / behavioral-guidance knobs** surfaced as profile config.
 *
 * The capability is exposed as `bit.llm`. The admin tools are only registered when the Bit serves an
 * MCP control plane (`isMcpEnabled()`), so a plain/MCP-off Bit is unaffected.
 */
export const LlmProfile: BitProfile = {
  name: 'llm',
  install(bit: Bit): void {
    const anyBit = bit as any;

    const override: { provider?: string; model?: string } = {};

    const getModel = (): { provider: string; model: string } => {
      const provider = override.provider
        || bit.getConfig<string>('LLM_PROVIDER', { required: false })
        || 'openai';
      const model = override.model
        || bit.getConfig<string>('LLM_MODEL', { required: false })
        || bit.getConfig<string>('OPENAI_MODEL', { required: false })
        || 'gpt-4o';
      return { provider, model };
    };

    const setModel = (next: { provider?: string; model?: string }): { provider: string; model: string } => {
      if (next.provider) override.provider = next.provider;
      if (next.model) override.model = next.model;
      return getModel();
    };

    const resolveProvider = (kind: 'language' | 'embedding' = 'language'): unknown => {
      const { provider, model } = getModel();
      const cfg: LlmProviderConfig = {
        provider,
        model,
        kind,
        baseURL: bit.getConfig<string>('LLM_BASE_URL', { required: false }),
        apiKey: bit.getConfig<string>('OPENAI_API_KEY', { required: false })
          || bit.getConfig<string>('LLM_API_KEY', { required: false }),
      };
      return getLlmProvider(cfg);
    };

    const getConfigKnobs = (): LlmConfigKnobs => ({
      memory: {
        maxMessages: num(bit, 'LLM_BOT_MEMORY_MAX_MESSAGES'),
        maxChars: num(bit, 'LLM_BOT_MEMORY_MAX_CHARS'),
      },
      behavioralGuidance: {
        enabled: bool(bit, 'LLM_BOT_BEHAVIORAL_GUIDANCE_ENABLED'),
        toolFilterEnabled: bool(bit, 'LLM_BOT_BEHAVIORAL_TOOL_FILTER_ENABLED'),
        gatingEnabled: bool(bit, 'LLM_BOT_BEHAVIORAL_GATING_ENABLED'),
      },
    });

    /**
     * Helper: Map sanitized MCP tool names back to PostgreSQL registry IDs.
     *
     * Tool names transform through sanitization (mcp:foo → mcp_foo). This helper
     * reverses that transformation to query the PostgreSQL registry.
     *
     * @param toolId - Sanitized tool name from MCP (e.g., "mcp_generate_image")
     * @returns Registry ID for PostgreSQL query (e.g., "mcp:generate-image")
     * @since Sprint 66
     */
    const mapToolNameToRegistryId = (toolId: string): string => {
      // Pattern 0a: mcp:mcp_* tools (double mcp prefix with colon separator)
      // Example: mcp:mcp_generate_image → mcp:generate_image
      // CRITICAL: This check must come BEFORE the general mcp: early return
      if (toolId.startsWith('mcp:mcp_')) {
        return toolId.replace(/^mcp:mcp_/, 'mcp:');
      }

      // Handle mcp:namespace/tool.name format (already correct)
      if (toolId.startsWith('mcp:')) {
        return toolId; // Already correct format
      }

      // Handle sanitized format: mcp_namespace_tool_name
      // Need to restore: mcp:namespace/tool.name or mcp:tool-name

      // Pattern 0b: mcp_mcp_* tools (double mcp prefix with underscore separator)
      // Example: mcp_mcp_generate_image → mcp:generate_image
      // Keep underscores as-is (don't convert to dashes/dots)
      if (toolId.startsWith('mcp_mcp_')) {
        const withoutDoublePrefix = toolId.replace(/^mcp_mcp_/, '');
        return `mcp:${withoutDoublePrefix}`;
      }

      // Pattern 1: mcp_namespace_tool_name → mcp:namespace/tool.name
      // Example: mcp_story_engine_mcp_bit_info → mcp:story-engine-mcp/bit.info
      const withSlashMatch = toolId.match(/^mcp_([a-z0-9_]+?)_([a-z0-9_]+)$/);
      if (withSlashMatch) {
        const namespace = withSlashMatch[1].replace(/_/g, '-');
        const toolName = withSlashMatch[2].replace(/_/g, '.');
        return `mcp:${namespace}/${toolName}`;
      }

      // Pattern 2: mcp_tool_name → mcp:tool-name
      // Example: mcp_generate_image → mcp:generate-image
      const simpleMatch = toolId.match(/^mcp_([a-z0-9_]+)$/);
      if (simpleMatch) {
        const toolName = simpleMatch[1].replace(/_/g, '-');
        return `mcp:${toolName}`;
      }

      // Fallback: Return as-is and log warning
      bit.getLogger().warn('bit.llm.prepareToolsForLlm.name_mapping_fallback', {
        toolId,
        message: 'Could not map tool name to registry ID',
      });
      return toolId;
    };

    /**
     * Prepare tools for LLM usage by injecting missing schemas from PostgreSQL tool registry.
     *
     * CRITICAL: Uses Promise.all() for parallel schema lookups to minimize latency.
     * Performance: ~50-100ms for 323 tools (vs ~1-2s sequential).
     *
     * @param tools - Tools from registry.getTools() (may have undefined inputSchema)
     * @returns Tools with schemas injected (ready for AI SDK)
     * @since Sprint 66
     */
    let toolStore: any = null; // Lazy-initialized on first use
    const prepareToolsForLlm = async (
      tools: Record<string, BitBratTool>
    ): Promise<Record<string, any>> => {
      const logger = bit.getLogger();
      const startTime = Date.now();

      // Lazy-init tool store (only when needed)
      if (!toolStore) {
        try {
          const documentStore = anyBit.getResource?.('documentStore');
          if (documentStore) {
            toolStore = documentStore; // Use existing PostgreSQL connection
            logger.debug('bit.llm.prepareToolsForLlm.store_initialized');
          } else {
            logger.warn('bit.llm.prepareToolsForLlm.no_store', {
              message: 'No documentStore available, schema injection disabled',
            });
          }
        } catch (err) {
          logger.error('bit.llm.prepareToolsForLlm.init_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ✅ PARALLEL: Process all tools concurrently using Promise.all()
      // This reduces latency from ~1-2s (sequential) to ~50-100ms (parallel)
      const enrichedToolEntries = await Promise.all(
        Object.entries(tools).map(async ([name, tool]) => {
          let inputSchema = tool.inputSchema;
          let schemaSource: 'postgresql' | 'mcp' | 'none' = tool.inputSchema ? 'mcp' : 'none';

          // ALWAYS try to fetch from PostgreSQL (prefer PostgreSQL over MCP)
          if (toolStore) {
            try {
              // Map tool name to registry ID (handle sanitization reversal)
              const toolId = mapToolNameToRegistryId(tool.id);

              // Query PostgreSQL tool registry
              const toolDoc = await toolStore.query('platform_tool_registry', {
                filters: [{ field: 'id', operator: '==', value: toolId }],
                limit: 1,
              });

              if (toolDoc?.[0]?.inputSchema) {
                const schema = toolDoc[0].inputSchema;
                const schemaData = schema.jsonSchema || schema;

                // Convert to AI SDK format using jsonSchema() helper
                inputSchema = jsonSchema(schemaData);
                schemaSource = 'postgresql';

                logger.debug('bit.llm.prepareToolsForLlm.schema_injected', {
                  toolName: name,
                  toolId: tool.id,
                  registryId: toolId,
                  schemaFound: true,
                  source: 'postgresql',
                  hadMcpSchema: !!tool.inputSchema,
                });
              } else {
                // PostgreSQL doesn't have schema - use MCP schema if available
                if (tool.inputSchema) {
                  logger.debug('bit.llm.prepareToolsForLlm.schema_fallback', {
                    toolName: name,
                    toolId: tool.id,
                    registryId: toolId,
                    source: 'mcp',
                    reason: 'not_in_postgresql',
                  });
                }
              }
            } catch (err) {
              // Fail-open: PostgreSQL errors should not block tool usage
              logger.warn('bit.llm.prepareToolsForLlm.schema_fetch_failed', {
                toolName: name,
                toolId: tool.id,
                error: err instanceof Error ? err.message : String(err),
                fallbackToMcp: !!tool.inputSchema,
              });
            }
          }

          // Return tool with schema (original or injected)
          return [
            name,
            {
              description: tool.description,
              inputSchema, // ✅ Now has schema (direct or injected)
              execute: tool.execute,
            },
          ];
        })
      );

      // Convert array of [name, tool] back to Record<string, any>
      const enrichedTools = Object.fromEntries(enrichedToolEntries);

      const duration = Date.now() - startTime;
      logger.info('bit.llm.prepareToolsForLlm.complete', {
        totalTools: Object.keys(tools).length,
        withSchema: Object.values(enrichedTools).filter((t: any) => t.inputSchema).length,
        withoutSchema: Object.values(enrichedTools).filter((t: any) => !t.inputSchema).length,
        durationMs: duration,
      });

      return enrichedTools;
    };

    const capability: LlmCapability = {
      getModel,
      setModel,
      resolveProvider,
      getConfigKnobs,
      toolFilter: { mode: 'off', list: [] },
      prepareToolsForLlm,
    };
    anyBit.llm = capability;

    // bit.llm.* admin tools are control-plane tools: only register when an MCP control plane is served.
    if (typeof anyBit.isMcpEnabled === 'function' && anyBit.isMcpEnabled()) {
      const ok = (data: any): CallToolResult => ({
        content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
      });

      // bit.llm.model — read/set the active provider+model.
      bit.registerTool(
        'bit.llm.model',
        'Read or set the active LLM provider and model for this Bit.',
        z.object({ provider: z.string().optional(), model: z.string().optional() }),
        async (args) => {
          if (args.provider || args.model) {
            const next = capability.setModel({ provider: args.provider, model: args.model });
            bit.getLogger().info('bit.llm.model.changed', next);
            return ok(next);
          }
          return ok(capability.getModel());
        },
        { scopes: OPERATE }
      );

      // bit.llm.promptPreview — render the assembled prompt with redaction applied.
      bit.registerTool(
        'bit.llm.promptPreview',
        'Render the assembled prompt for the given inputs, with secrets/PII redacted.',
        z.object({
          summary: z.string().optional(),
          instructions: z.array(z.string()).optional(),
          input: z.string().optional(),
        }),
        async (args) => {
          const spec: PromptSpec = {
            systemPrompt: args.summary
              ? { summary: args.summary, rules: args.instructions || [] }
              : undefined,
            task: (args.instructions && args.instructions.length)
              ? args.instructions.map((instruction) => ({ instruction }))
              : [{ instruction: 'Respond to the user input.' }],
            input: { userQuery: args.input || '' },
          };
          const cfg: AssemblerConfig = {};
          const assembled = assemble(spec, cfg);
          const text = typeof assembled?.text === 'string' ? assembled.text : JSON.stringify(assembled);
          return ok({ model: capability.getModel(), prompt: redactText(text) });
        },
        { scopes: READ }
      );

      // bit.llm.toolFilter — inspect/adjust which discovered tools are exposed to the loop.
      bit.registerTool(
        'bit.llm.toolFilter',
        'Inspect or adjust which discovered MCP tools are exposed to the LLM loop.',
        z.object({
          mode: z.enum(['off', 'allow', 'deny']).optional(),
          list: z.array(z.string()).optional(),
        }),
        async (args) => {
          if (args.mode !== undefined || args.list !== undefined) {
            if (args.mode !== undefined) capability.toolFilter.mode = args.mode;
            if (args.list !== undefined) capability.toolFilter.list = args.list;
            bit.getLogger().info('bit.llm.toolFilter.changed', { ...capability.toolFilter });
          }
          let available: string[] = [];
          try {
            const reg = anyBit.mcpClient?.registry;
            const tools = reg?.getTools?.();
            if (tools) available = Object.keys(tools);
          } catch { /* ignore — registry optional */ }
          return ok({ filter: capability.toolFilter, available });
        },
        { scopes: OPERATE }
      );
    }

    bit.getLogger().debug('bit.llm.installed');
  },
};
