import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { INTERNAL_COMMAND_V1, InternalEventV1, InternalEventV2 } from '../types/events';
import { AttributeMap, createMessageSubscriber } from '../services/message-bus';
import { toV1, toV2 } from '../common/events/adapters';
import { logger } from '../common/logging';

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
              const asV1: InternalEventV1 | null = raw && raw.envelope ? (raw as InternalEventV1) : null;
              const v2: InternalEventV2 = asV1 ? toV2(asV1) : (raw as InternalEventV2);

              // Minimal no-op handler: log receipt and ack
              logger.info('command_processor.event.received', {
                type: v2?.type,
                correlationId: (v2 as any)?.correlationId,
                source: v2?.source,
              });
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
