import '../common/safe-timers';
import { BaseServer } from '../common/base-server';
import { McpServer } from '../common/mcp-server';
import { Express } from 'express';
import { INTERNAL_INGRESS_V1, INTERNAL_USER_ENRICHED_V1, InternalEventV2 } from '../types/events';
import { AttributeMap, createMessagePublisher } from '../services/message-bus';
import { FirestoreUserRepo } from '../services/auth/user-repo';
import { enrichEvent } from '../services/auth/enrichment';
import { logger } from '../common/logging';
import { counters } from '../common/counters';
import { busAttrsFromEvent } from '../common/events/attributes';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import crypto from 'crypto';

const SERVICE_NAME = process.env.SERVICE_NAME || 'auth';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export class AuthServer extends McpServer {
  private userRepo?: FirestoreUserRepo;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, cfg: any) {
    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';

    // Debug counters endpoint via BaseServer helper
    this.onHTTPRequest('/_debug/counters', (_req, res) => {
      res.status(200).json({ counters: counters.snapshot() });
    });

    const db = this.getResource<Firestore>('firestore');
    this.userRepo = new FirestoreUserRepo('users', db);

    this.registerAdminTools();

    // Message bus subscription (skipped in test to avoid external clients during Jest)
    if (isTestEnv) {
      logger.debug('auth.subscribe.disabled_for_tests');
      return;
    }

    const inputSubject = `${cfg.busPrefix || ''}${INTERNAL_INGRESS_V1}`;
    const outTopic = process.env.AUTH_ENRICH_OUTPUT_TOPIC || INTERNAL_USER_ENRICHED_V1;
    const outputSubject = `${cfg.busPrefix || ''}${outTopic}`;
    const pubRes = this.getResource<PublisherResource>('publisher');
    const publisher = pubRes ? pubRes.create(outputSubject) : createMessagePublisher(outputSubject);
    const userRepo = this.userRepo;

    logger.info('auth.subscribe.start', { subject: inputSubject, queue: 'auth' });
    try {
      await this.onMessage<InternalEventV2>(
        { destination: INTERNAL_INGRESS_V1, queue: 'auth', ack: 'explicit' },
        async (asV2: InternalEventV2, attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
          try {
            counters.increment('auth.enrich.total');

            // Create a child span for enrichment and publish for better trace visibility
            const tracer = (this as any).getTracer?.();
            const run = async () => {
              const { event: enrichedV2Initial, matched, userRef, created, isFirstMessage, isNewSession } = await enrichEvent(asV2, userRepo, {
                provider: (asV2 as any)?.source?.split('.')?.[1],
              });

              // Do NOT append an 'auth' step to the routingSlip here.
              // Per requirement: keep routingSlip untouched before event-router.
              const enrichedV2: InternalEventV2 = enrichedV2Initial;

              if (matched) {
                counters.increment('auth.enrich.matched');
                logger.debug('auth.enrich.matched', { correlationId: enrichedV2.correlationId, userRef, outputSubject });
                if (created) counters.increment('auth.enrich.created_user');
                if (isFirstMessage) counters.increment('auth.enrich.first_message');
                if (isNewSession) counters.increment('auth.enrich.new_session');
              } else {
                counters.increment('auth.enrich.unmatched');
                logger.debug('auth.enrich.unmatched', { correlationId: enrichedV2.correlationId, outputSubject });
              }

              const pubAttrs: AttributeMap = busAttrsFromEvent(enrichedV2);
              publisher.publishJson(enrichedV2, pubAttrs);
              logger.debug('auth.publish', { event: enrichedV2 });
              logger.info('auth.publish.ok', { subject: outputSubject });
            };
            if (tracer && typeof tracer.startActiveSpan === 'function') {
              await tracer.startActiveSpan('user-enrichment', async (span: any) => {
                try {
                  await run();
                } finally {
                  span.end();
                }
              });
            } else {
              await run();
            }
            await ctx.ack();
          } catch (e: any) {
            const msg = e?.message || String(e);
            counters.increment('auth.enrich.errors');
            logger.error('auth.ingress.process_error', { subject: inputSubject, error: msg });
            // Poison JSON -> ack; known network/publish timeouts -> ack to avoid redelivery storm; otherwise nack(requeue)
            const isJsonError = /json|unexpected token|position \d+/i.test(msg);
            const code = (e && (e.code || e.status)) || undefined;
            const isPublishTimeout = code === 4 /* DEADLINE_EXCEEDED */ || /DEADLINE_EXCEEDED|name resolution|getaddrinfo|ENOTFOUND|EAI_AGAIN|Waiting for LB pick/i.test(msg);
            if (isJsonError || isPublishTimeout) {
              await ctx.ack();
            } else {
              await ctx.nack(true);
            }
          }
        }
      );
      logger.info('auth.subscribe.ok', { subject: inputSubject, queue: 'auth' });
    } catch (e: any) {
      logger.error('auth.subscribe.error', { subject: inputSubject, error: e?.message || String(e) });
    }
  }

  private registerAdminTools() {
    this.registerTool(
      'update_user',
      'Update user information such as roles or status.',
      z.object({
        userId: z.string().optional().describe('The internal user ID (e.g. twitch:12345)'),
        displayName: z.string().optional().describe('The user display name for lookup if userId is not known'),
        email: z.string().optional().describe('The user email for lookup if userId is not known'),
        roles: z.array(z.string()).optional().describe('The new list of roles for the user'),
        status: z.string().optional().describe('The new status for the user (e.g. active, banned)'),
      }),
      async (args) => {
        let userId = args.userId;

        if (!userId && (args.displayName || args.email)) {
          const matches = await this.userRepo!.searchUsers({
            displayName: args.displayName,
            email: args.email,
          });
          if (matches.length === 0) {
            return {
              content: [{ type: 'text', text: 'User not found.' }],
              isError: true,
            };
          }
          if (matches.length > 1) {
            return {
              content: [{ type: 'text', text: `Multiple users found (${matches.length}). Please provide more specific information or a userId.` }],
              isError: true,
            };
          }
          userId = matches[0].id;
        }

        if (!userId) {
          return {
            content: [{ type: 'text', text: 'Missing userId or lookup information.' }],
            isError: true,
          };
        }

        const update: any = {};
        if (args.roles) update.roles = args.roles;
        if (args.status) update.status = args.status;

        const updated = await this.userRepo!.updateUser(userId, update);
        if (!updated) {
          return {
            content: [{ type: 'text', text: `Failed to update user ${userId}. User might not exist.` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: `User ${updated.displayName} (${updated.id}) updated successfully.` }],
        };
      }
    );

    this.registerTool(
      'ban_user',
      'Ban a user from the platform. This updates their status to banned and triggers platform-level bans.',
      z.object({
        userId: z.string().optional().describe('The internal user ID'),
        displayName: z.string().optional().describe('The user display name for lookup'),
        reason: z.string().describe('Reason for banning'),
      }),
      async (args) => {
        let userId = args.userId;

        if (!userId && args.displayName) {
          const matches = await this.userRepo!.searchUsers({ displayName: args.displayName });
          if (matches.length === 0) {
            return { content: [{ type: 'text', text: 'User not found.' }], isError: true };
          }
          if (matches.length > 1) {
            return { content: [{ type: 'text', text: `Multiple users found with name ${args.displayName}.` }], isError: true };
          }
          userId = matches[0].id;
        }

        if (!userId) {
          return { content: [{ type: 'text', text: 'Missing userId or displayName.' }], isError: true };
        }

        const user = await this.userRepo!.getById(userId);
        if (!user) {
          return { content: [{ type: 'text', text: 'User not found.' }], isError: true };
        }

        // 1. Update status in Firestore
        await this.userRepo!.updateUser(userId, { status: 'banned' });

        // 2. Emit moderation event
        const platform = userId.split(':')[0];
        const platformUserId = userId.split(':')[1];

        const moderationEvent = {
          v: '1',
          source: 'auth',
          correlationId: `ban-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'moderation.action.v1',
          payload: {
            action: 'ban',
            userId,
            platform,
            platformUserId,
            reason: args.reason,
            actor: 'llm-bot',
          },
        };

        const cfg: any = this.getConfig();
        const prefix = cfg.busPrefix || '';
        const subject = `${prefix}internal.ingress.v1`; // We route back to ingress for cross-platform effects
        const pubRes = this.getResource<PublisherResource>('publisher');
        const publisher = pubRes ? pubRes.create(subject) : createMessagePublisher(subject);

        await publisher.publishJson(moderationEvent, {
          type: 'moderation.action.v1',
          correlationId: moderationEvent.correlationId,
          source: SERVICE_NAME,
        });

        return {
          content: [{ type: 'text', text: `User ${user.displayName || user.id} has been banned. Reason: ${args.reason}` }],
        };
      }
    );

    this.registerTool(
      'create_api_token',
      'Create an API token for a user. This returns the raw token to be shared with the user and stores the hash for validation.',
      z.object({
        userId: z.string().optional().describe('The internal user ID (e.g. twitch:12345)'),
        displayName: z.string().optional().describe('The user display name for lookup'),
      }),
      async (args) => {
        let userId = args.userId;

        if (!userId && args.displayName) {
          const matches = await this.userRepo!.searchUsers({ displayName: args.displayName });
          if (matches.length === 0) {
            return { content: [{ type: 'text', text: 'User not found.' }], isError: true };
          }
          if (matches.length > 1) {
            return { content: [{ type: 'text', text: `Multiple users found with name ${args.displayName}.` }], isError: true };
          }
          userId = matches[0].id;
        }

        if (!userId) {
          return { content: [{ type: 'text', text: 'Missing userId or displayName.' }], isError: true };
        }

        const user = await this.userRepo!.getById(userId);
        if (!user) {
          return { content: [{ type: 'text', text: 'User not found.' }], isError: true };
        }

        // 1. Generate token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // 2. Store in Firestore
        const db = this.getResource<Firestore>('firestore');
        if (!db) {
          return { content: [{ type: 'text', text: 'Firestore resource not available.' }], isError: true };
        }

        const now = new Date();
        const tokenDoc = {
          user_id: userId,
          created_at: now,
          token_hash: hash,
        };

        await db.collection('gateways/api/tokens').doc(hash).set(tokenDoc);

        // 3. Publish event
        const correlationId = `token-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const event: InternalEventV2 = {
          v: '1',
          source: SERVICE_NAME,
          correlationId,
          type: 'token.created.v1',
          userId,
          payload: {
            user_id: userId,
            created_at: now.toISOString(),
            token_hash: hash,
            raw_token: rawToken,
          },
          egress: { destination: 'system' }
        };

        const cfg: any = this.getConfig();
        const prefix = cfg.busPrefix || '';
        const subject = `${prefix}internal.ingress.v1`;
        const pubRes = this.getResource<PublisherResource>('publisher');
        const publisher = pubRes ? pubRes.create(subject) : createMessagePublisher(subject);

        await publisher.publishJson(event, {
          type: 'token.created.v1',
          correlationId,
          source: SERVICE_NAME,
        });

        return {
          content: [
            {
              type: 'text',
              text: `API token created for ${user.displayName || user.id}.\n\nRaw Token: ${rawToken}\n\nPlease share this token with the user. It will not be shown again.`,
            },
          ],
        };
      }
    );
  }
}

export function createApp() {
  const server = new AuthServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[auth] listening on port ' + PORT);
  });
}
