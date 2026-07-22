import { Bit } from '../common/base-server';
import { z } from 'zod';
import { Express, Request, Response } from 'express';
import type { InternalEventV2 } from '../types/events';
import { INTERNAL_EGRESS_V1 } from '../types/events';
import { MutationProposal, StateSnapshot, MutationLogEntry, INTERNAL_STATE_MUTATION_V1 } from '../types/state';
import jsonLogic from 'json-logic-js';
import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../common/persistence/interfaces';
import { PublisherResource } from '../common/resources/publisher-manager';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import yaml from 'js-yaml';
import { createStateEngineStore, type IStateEngineStore } from './state-engine-repository';

const SERVICE_NAME = process.env.SERVICE_NAME || 'state-engine';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

type RuleAction = { type: 'publishEgress'; payload: Record<string, any> };
interface RuleDef { id: string; when: any; actions: RuleAction[] }
interface StateEngineConfig {
  rules: RuleDef[];
  allowedKeys: string[];
}

const DEFAULT_CONFIG: StateEngineConfig = {
  allowedKeys: ['stream.state', 'stream.title', 'stream.category', 'obs.scene', 'user.disposition.*', 'user.fact.*'],
  rules: [
    {
      id: 'on_stream_start',
      when: { 'and': [ { '==': [ { var: 'key' }, 'stream.state' ] }, { '==': [ { var: 'value' }, 'on' ] } ] },
      actions: [
        {
          type: 'publishEgress',
          payload: {
            type: 'system.stream.online',
            message: 'Stream detected online',
            annotations: [{ id: 'state-engine', kind: 'intent', label: 'stream.online', source: 'state-engine', createdAt: new Date().toISOString() }]
          }
        }
      ]
    }
  ]
};

export class StateEngineServer extends Bit {
  private stateConfig: StateEngineConfig;
  private store: IStateEngineStore;

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });
    this.stateConfig = this.loadStateConfig();

    // Initialize store - use documentStore (PostgreSQL) or fallback to Firestore (legacy)
    const documentStore = this.getResource<any>('documentStore') || this.getResource<Firestore>('firestore');
    this.store = createStateEngineStore(documentStore);

    this.setupApp(this.getApp() as any, this.getConfig() as any);
    this.setupMcpTools();
  }

  private loadStateConfig(): StateEngineConfig {
    const configPath = process.env.STATE_ENGINE_CONFIG_PATH;
    if (configPath && fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        const loaded = yaml.load(fileContent) as any;
        return {
          allowedKeys: loaded.allowedKeys || DEFAULT_CONFIG.allowedKeys,
          rules: loaded.rules || DEFAULT_CONFIG.rules,
        };
      } catch (e: any) {
        this.getLogger().error('state-engine.config.load_error', { path: configPath, error: e.message });
      }
    }
    return DEFAULT_CONFIG;
  }

  private setupMcpTools() {
    this.registerTool(
      'get_state',
      'Returns current values and versions for specified state keys.',
      z.object({
        keys: z.array(z.string()),
      }),
      async (args) => {
        const results: Record<string, any> = {};
        for (const key of args.keys) {
          const snapshot = await this.store.getState(key);
          results[key] = snapshot || null;
        }
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.registerTool(
      'get_state_prefix',
      'Returns key/value pairs matching a prefix.',
      z.object({
        prefix: z.string(),
      }),
      async (args) => {
        const results = await this.store.getStateByPrefix(args.prefix);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.registerTool(
      'propose_mutation',
      `Submits a mutation proposal to change state. Only keys within the allowed namespaces are accepted; ` +
        `proposals for any other key are rejected and NOT persisted. Allowed keys: ${this.stateConfig.allowedKeys.join(', ')} ` +
        `(a trailing '*' denotes a prefix, e.g. store a personal fact under 'user.fact.<userId>.<topic>').`,
      z.object({
        key: z.string(),
        value: z.any(),
        op: z.enum(['set','delete','increment','push']).optional().default('set'),
        reason: z.string(),
        expectedVersion: z.number().optional(),
      }),
      async (args) => {
        // Pre-validate against the same allow-list the consumer enforces in handleMutation(). The
        // mutation pipeline is fire-and-forget (publish to the bus, validate asynchronously), so
        // without this check a disallowed key would be silently rejected while the tool still
        // reported success. Surface the rejection to the caller instead of returning a false positive.
        if (!this.isAllowedKey(args.key)) {
          this.getLogger().warn('state-engine.propose_mutation.rejected', { key: args.key, reason: 'Key not allowed' });
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Mutation rejected: key '${args.key}' is not in an allowed namespace, so nothing was stored. ` +
                `Allowed keys: ${this.stateConfig.allowedKeys.join(', ')} (a trailing '*' denotes a prefix).`,
            }],
          };
        }

        const publisher = this.getResource<PublisherResource>('publisher');
        if (!publisher) throw new Error('Publisher not available');

        const mutation: MutationProposal = {
          id: uuidv4(),
          op: args.op || 'set',
          key: args.key,
          value: args.value,
          actor: 'llm-bot', // Assuming llm-bot is the caller via MCP
          reason: args.reason,
          expectedVersion: args.expectedVersion,
          ts: new Date().toISOString(),
        };

        const cfg: any = this.getConfig?.() || {};
        const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
        const needsPrefix = (s: string) => !!prefix && !s.startsWith(prefix);
        const subject = needsPrefix(INTERNAL_STATE_MUTATION_V1) ? `${prefix}${INTERNAL_STATE_MUTATION_V1}` : INTERNAL_STATE_MUTATION_V1;

        await publisher.create(subject).publishJson(mutation);

        return { content: [{ type: 'text', text: `Mutation ${mutation.id} proposed for ${mutation.key}` }] };
      }
    );
  }

  private isAllowedKey(key: string): boolean {
    return this.stateConfig.allowedKeys.some((allowed) => {
      if (allowed.endsWith('*')) {
        return key.startsWith(allowed.slice(0, -1));
      }
      return allowed === key;
    });
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)
    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', service: SERVICE_NAME });
    });

    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        uuidv4().slice(0, 8);

      { // subscription for internal.state.mutation.v1
        const destination = INTERNAL_STATE_MUTATION_V1; // Let BaseServer apply busPrefix
        const queue = SERVICE_NAME;

        this.getLogger().debug('state-engine.mutation.subscription', { destination, queue });

        try {
          await this.onMessage<MutationProposal>(
            { destination, queue, ack: 'explicit' },
            async (mutation: MutationProposal, _attributes, ctx) => {
              try {
                this.getLogger().info('state-engine.mutation.received', {
                  mutationId: mutation.id,
                  key: mutation.key,
                  op: mutation.op
                });

                await this.handleMutation(mutation);
                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('state-engine.mutation.handler_error', { mutationId: mutation.id, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('state-engine.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('state-engine.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      this.getLogger().warn('state-engine.subscribe.init_error', { error: e?.message || String(e) });
    }
  }

  private async handleMutation(mutation: MutationProposal) {
    // 1. Validate
    if (!this.isAllowedKey(mutation.key)) {
      await this.store.logMutation(mutation, 'rejected', 'Key not allowed');
      return;
    }

    // 2. Commit with Optimistic Concurrency
    const result = await this.store.commitMutation(mutation);

    if (result.success) {
      this.getLogger().info('state-engine.mutation.committed', {
        mutationId: mutation.id,
        key: mutation.key,
        resultingVersion: result.resultingVersion
      });

      // 3. Evaluate Rules
      await this.evaluateRules(mutation.key, mutation.value);
    } else {
      this.getLogger().error('state-engine.mutation.commit_failed', {
        mutationId: mutation.id,
        error: result.error
      });
      await this.store.logMutation(mutation, 'rejected', result.error);
    }
  }


  private async evaluateRules(key: string, value: any) {
    for (const rule of this.stateConfig.rules) {
      try {
        const matched = jsonLogic.apply(rule.when, { key, value });
        if (!matched) continue;
        for (const action of rule.actions) {
          if (action.type === 'publishEgress') {
            await this.publishEgress(action.payload);
          }
        }
      } catch (e: any) {
        this.getLogger().warn('state-engine.rule.eval_error', { ruleId: rule.id, error: e?.message || String(e) });
      }
    }
  }

  private async publishEgress(payload: Record<string, any>) {
    try {
      const pub = this.getResource<PublisherResource>('publisher');
      if (!pub) return;
      const cfg: any = this.getConfig?.() || {};
      const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
      const subject = `${prefix}${INTERNAL_EGRESS_V1}`;
      await pub.create(subject).publishJson(payload, { type: String(payload?.type || 'state-engine.rule') });
    } catch (e: any) {
      this.getLogger().warn('state-engine.egress.publish_error', { error: e?.message || String(e) });
    }
  }
}

export function createServer() {
  return new StateEngineServer();
}

export function createApp() {
  const server = createServer();
  return server.getApp();
}

if (require.main === module) {
  Bit.ensureRequiredEnv(SERVICE_NAME);
  const server = new StateEngineServer();
  void server.start(PORT);
}
