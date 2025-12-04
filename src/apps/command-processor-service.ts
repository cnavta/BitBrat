import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_COMMAND_V1, InternalEventV2, RoutingStep } from '../types/events';
import { AttributeMap, createMessagePublisher, createMessageSubscriber } from '../services/message-bus';
import { logger } from '../common/logging';
import { summarizeSlip } from '../services/routing/slip';
import { findByNameOrAlias } from '../services/command-processor/command-repo';
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
    // Subscribe is disabled in tests only when explicitly requested via MESSAGE_BUS_DISABLE_SUBSCRIBE=1
    // Rationale: Some tests intentionally enable subscription while running under Jest.
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
    if (isTestEnv) {
      logger.debug('command_processor.subscribe.disabled_for_tests');
      return;
    }

    const subject = `${cfg.busPrefix || ''}${INTERNAL_COMMAND_V1}`;
    const subscriber = createMessageSubscriber();
    logger.info('command_processor.subscribe.start', { subject, queue: 'command-processor' });
    try {
      await subscriber.subscribe(
        subject,
        async (data: Buffer, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
          try {
            const raw = JSON.parse(data.toString('utf8')) as any;
            // Assume V2 payloads
            const preV2: InternalEventV2 = raw as InternalEventV2;
            logger.info('command_processor.event.received', {
              type: preV2?.type,
              correlationId: (preV2 as any)?.correlationId,
              source: preV2?.source,
            });

            // Lazy-load processor to allow Jest doMock() to override in tests after this module is loaded
            const { processEvent } = require('../services/command-processor/processor');
            const db = this.getResource<Firestore>('firestore');
            const result = await processEvent(raw, {
              repoFindByNameOrAlias: (name: string) => findByNameOrAlias(name, db),
            });
            const v2 = result.event;
            logger.info('command_processor.event.processed', {result});

            // Mark current pending step OK/SKIP based on processor result, then advance per routing slip
            const slip = (v2.routingSlip || []) as RoutingStep[];
            const nextIdx = slip.findIndex((s: RoutingStep) => s.status === 'PENDING');
            if (nextIdx >= 0) {
              slip[nextIdx].status = result.stepStatus;
              slip[nextIdx].endedAt = new Date().toISOString();
            }
            if (nextIdx >= 0 && slip[nextIdx].nextTopic) {
              const nextTopic = `${(cfg.busPrefix || '')}${slip[nextIdx].nextTopic}`;
              const pubRes = this.getResource<PublisherResource>('publisher');
              // In Jest, prefer direct factory to honor per-test mocks reliably
              const preferFactory = typeof process.env.JEST_WORKER_ID !== 'undefined';
              const publisher = (!preferFactory && pubRes) ? pubRes.create(nextTopic) : createMessagePublisher(nextTopic);
              await publisher.publishJson(v2, { type: v2.type, correlationId: v2.correlationId, source: v2.source });
              logger.info('command_processor.advance.next', { nextTopic, slip: summarizeSlip(slip) });
            } else if (v2.egressDestination) {
              const nextTopic = `${(cfg.busPrefix || '')}${v2.egressDestination}`;
              const pubRes = this.getResource<PublisherResource>('publisher');
              const preferFactory = typeof process.env.JEST_WORKER_ID !== 'undefined';
              const publisher = (!preferFactory && pubRes) ? pubRes.create(nextTopic) : createMessagePublisher(nextTopic);
              await publisher.publishJson(v2, { type: v2.type, correlationId: v2.correlationId, source: v2.source });
              logger.info('command_processor.advance.egress', { nextTopic, slip: summarizeSlip(slip) });
            } else {
              logger.info('command_processor.advance.complete', { slip: summarizeSlip(slip) });
            }

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
        },
        { queue: 'command-processor', ack: 'explicit' }
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
