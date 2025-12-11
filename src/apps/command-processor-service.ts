import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_COMMAND_V1, InternalEventV2, RoutingStep } from '../types/events';
import { AttributeMap, createMessagePublisher } from '../services/message-bus';
import { logger } from '../common/logging';
import { summarizeSlip } from '../services/routing/slip';
import { findFirstByCommandTerm } from '../services/command-processor/command-repo';
import { startRegexCache } from '../services/command-processor/regex-cache';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';

const SERVICE_NAME = process.env.SERVICE_NAME || 'command-processor';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class CommandProcessorServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    // Invoke setup synchronously so tests using jest.isolateModules() can observe subscription immediately
    this.setupApp(this.getConfig());
  }

  private async setupApp(cfg: any) {
    const subject = `${cfg.busPrefix || ''}${INTERNAL_COMMAND_V1}`;
    logger.info('command_processor.subscribe.start', { subject, queue: 'command-processor' });
    try {
      // Initialize regex cache live updates
      try {
        const db = this.getResource<Firestore>('firestore');
        startRegexCache(db);
        logger.info('command_processor.regex_cache.started');
      } catch (e: any) {
        logger.warn('command_processor.regex_cache.start_error', { error: e?.message || String(e) });
      }
      await this.onMessage<InternalEventV2>(
        { destination: INTERNAL_COMMAND_V1, queue: 'command-processor', ack: 'explicit' },
        async (preV2: InternalEventV2, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
          try {
            logger.info('command_processor.event.received', {
              type: preV2?.type,
              correlationId: (preV2 as any)?.correlationId,
              source: preV2?.source,
            });

            // Lazy-load processor to allow Jest doMock() to override in tests after this module is loaded
            const { processEvent } = require('../services/command-processor/processor');
            const db = this.getResource<Firestore>('firestore');
            // Wrap execution in a child span when tracing is enabled
            const tracer = (this as any).getTracer?.();
            const exec = async () => {
              return await processEvent(preV2 as any, { repoFindFirstByCommandTerm: (term: string) => findFirstByCommandTerm(term, db) });
            };
            const result = tracer && typeof tracer.startActiveSpan === 'function'
              ? await tracer.startActiveSpan('execute-command', async (span: any) => {
                  try {
                    return await exec();
                  } finally {
                    span.end();
                  }
                })
              : await exec();
            const v2 = result.event;
            logger.info('command_processor.event.processed', { result });

            // Preserve legacy logging: if no pending and no egress, log completion and do not dispatch
            const slip = (v2.routingSlip || []) as RoutingStep[];
            const hasPending = slip.findIndex((s: RoutingStep) => s.status !== 'OK' && s.status !== 'SKIP') >= 0;
            if (!hasPending && !v2.egressDestination) {
              logger.info('command_processor.advance.complete', { slip: summarizeSlip(slip) });
              await ctx.ack();
              return;
            }

            // Align attribute expectations: set event.source to this service before forwarding
            v2.source = SERVICE_NAME;

            // Advance using BaseServer helper (optionally sets current step status, idempotency, attributes, tracing)
            await (this as any).next(v2, result.stepStatus);
            logger.info('command_processor.advance.dispatched', { slip: summarizeSlip(slip), egress: v2.egressDestination });

            await ctx.ack();
          } catch (e: any) {
            const msg = e?.message || String(e);
            logger.error('command_processor.process_error', { subject, error: msg });
            if (/json|unexpected token|position \d+/i.test(msg)) {
              await ctx.ack();
            } else {
              await ctx.nack(true);
            }
          }
        }
      );
      logger.info('command_processor.subscribe.ok', { subject, queue: 'command-processor' });
    } catch (e: any) {
      logger.error('command_processor.subscribe.error', { subject, error: e?.message || String(e) });
    }
  }
}

export function createApp() {
  const server = new CommandProcessorServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[command-processor] listening on port ' + PORT);
  });
}
