import type { Bit } from '../base-server';
import { BitProfile } from './types';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getLlmProvider, LlmProviderConfig } from '../llm/provider-factory';
import { assemble } from '../prompt-assembly/assemble';
import { redactText } from '../prompt-assembly/redaction';
import type { PromptSpec, AssemblerConfig } from '../prompt-assembly/types';

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

    const capability: LlmCapability = {
      getModel,
      setModel,
      resolveProvider,
      getConfigKnobs,
      toolFilter: { mode: 'off', list: [] },
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
