import { McpServer } from '../common/mcp-server';
import { BaseServer } from '../common/base-server';
import { z } from 'zod';
import { Express, Request, Response } from 'express';
import type { InternalEventV2 } from '../types/events';
import { INTERNAL_EGRESS_V1 } from '../types/events';
import { MutationProposal, StateSnapshot, MutationLogEntry, INTERNAL_STATE_MUTATION_V1 } from '../types/state';
import jsonLogic from 'json-logic-js';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { PublisherResource } from '../common/resources/publisher-manager';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import yaml from 'js-yaml';

const SERVICE_NAME = process.env.SERVICE_NAME || 'state-engine';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

type RuleAction = { type: 'publishEgress'; payload: Record<string, any> };
interface RuleDef { id: string; when: any; actions: RuleAction[] }
interface StateEngineConfig {
  rules: RuleDef[];
  allowedKeys: string[];
}

const DEFAULT_CONFIG: StateEngineConfig = {
  allowedKeys: ['stream.state', 'stream.title', 'stream.category', 'obs.scene'],
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

export class StateEngineServer extends McpServer {
  private stateConfig: StateEngineConfig;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.stateConfig = this.loadStateConfig();
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
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error('Firestore not available');

        const results: Record<string, any> = {};
        for (const key of args.keys) {
          const doc = await firestore.collection('state').doc(key).get();
          if (doc.exists) {
            results[key] = doc.data();
          } else {
            results[key] = null;
          }
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
        const firestore = this.getResource<Firestore>('firestore');
        if (!firestore) throw new Error('Firestore not available');

        const snapshot = await firestore.collection('state')
          .where(FieldPath.documentId(), '>=', args.prefix)
          .where(FieldPath.documentId(), '<', args.prefix + '\uf8ff')
          .get();

        const results: Record<string, any> = {};
        snapshot.forEach(doc => {
          results[doc.id] = doc.data();
        });

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.registerTool(
      'propose_mutation',
      'Submits a mutation proposal to change state.',
      z.object({
        key: z.string(),
        value: z.any(),
        op: z.enum(['set','delete','increment','push']).optional().default('set'),
        reason: z.string(),
        expectedVersion: z.number().optional(),
      }),
      async (args) => {
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
    const firestore = this.getResource<Firestore>('firestore');
    if (!firestore) throw new Error('Firestore not available');

    // 1. Validate
    if (!this.stateConfig.allowedKeys.includes(mutation.key)) {
      await this.logMutation(mutation, 'rejected', 'Key not allowed');
      return;
    }

    // 2. Commit with Optimistic Concurrency
    try {
      await firestore.runTransaction(async (transaction) => {
        const stateRef = firestore.collection('state').doc(mutation.key);
        const doc = await transaction.get(stateRef);

        let currentVersion = 0;
        if (doc.exists) {
          currentVersion = doc.data()?.version || 0;
        }

        if (mutation.expectedVersion !== undefined && mutation.expectedVersion !== currentVersion) {
          throw new Error(`Version mismatch: expected ${mutation.expectedVersion}, found ${currentVersion}`);
        }

        const nextVersion = currentVersion + 1;
        const snapshot: StateSnapshot = {
          value: mutation.value,
          updatedAt: new Date().toISOString(),
          updatedBy: mutation.actor,
          version: nextVersion,
          ttl: mutation.ttl || null,
          metadata: {
            source: mutation.reason,
            ...mutation.metadata
          }
        };

        transaction.set(stateRef, snapshot);
        await this.logMutation(mutation, 'accepted', undefined, nextVersion, transaction);
      });

      this.getLogger().info('state-engine.mutation.committed', { mutationId: mutation.id, key: mutation.key });
      
      // 3. Evaluate Rules
      await this.evaluateRules(mutation.key, mutation.value);
    } catch (e: any) {
      this.getLogger().error('state-engine.mutation.commit_failed', { mutationId: mutation.id, error: e.message });
      await this.logMutation(mutation, 'rejected', e.message);
    }
  }

  private async logMutation(
    mutation: MutationProposal, 
    status: 'accepted' | 'rejected', 
    error?: string, 
    resultingVersion?: number,
    transaction?: FirebaseFirestore.Transaction
  ) {
    const firestore = this.getResource<Firestore>('firestore');
    if (!firestore) return;

    const logEntry: MutationLogEntry = {
      ...mutation,
      committedAt: new Date().toISOString(),
      status,
      error,
      resultingVersion
    };

    const logRef = firestore.collection('mutation_log').doc(mutation.id);
    if (transaction) {
      transaction.set(logRef, logEntry);
    } else {
      await logRef.set(logEntry);
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

export function createApp() {
  const server = new StateEngineServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new StateEngineServer();
  void server.start(PORT);
}
