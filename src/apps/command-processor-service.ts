import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_COMMAND_V1, InternalEventV1, InternalEventV2 } from '../types/events';
import { AttributeMap, createMessagePublisher, createMessageSubscriber } from '../services/message-bus';
import { toV1, toV2 } from '../common/events/adapters';
import { logger } from '../common/logging';
import { getConfig } from '../common/config';
import { processEvent } from '../services/command-processor/processor';
import { summarizeSlip } from '../services/routing/slip';

const SERVICE_NAME = process.env.SERVICE_NAME || 'command-processor';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: async (_app: Express, cfg) => {
      const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
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
              // Log receipt immediately after normalization to V2 to avoid dependency on downstream processing
              const preV2: InternalEventV2 = raw && (raw as any).envelope ? toV2(raw as InternalEventV1) : (raw as InternalEventV2);
              logger.info('command_processor.event.received', {
                type: preV2?.type,
                correlationId: (preV2 as any)?.correlationId,
                source: preV2?.source,
              });

              const result = await processEvent(raw);
              const v2 = result.event;

              // Mark current pending step OK/SKIP based on processor result, then advance per routing slip
              const slip = v2.routingSlip || [];
              const nextIdx = slip.findIndex((s) => s.status === 'PENDING');
              if (nextIdx >= 0) {
                slip[nextIdx].status = result.stepStatus;
                slip[nextIdx].endedAt = new Date().toISOString();
              }
              if (nextIdx >= 0 && slip[nextIdx].nextTopic) {
                const nextTopic = `${(cfg.busPrefix || '')}${slip[nextIdx].nextTopic}`;
                const publisher = createMessagePublisher(nextTopic);
                await publisher.publishJson(v2, { type: v2.type, correlationId: v2.correlationId, source: v2.source });
                logger.info('command_processor.advance.next', { nextTopic, slip: summarizeSlip(slip) });
              } else if (v2.egressDestination) {
                const nextTopic = `${(cfg.busPrefix || '')}${v2.egressDestination}`;
                const publisher = createMessagePublisher(nextTopic);
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
    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[command-processor] listening on port ' + PORT);
  });
}
