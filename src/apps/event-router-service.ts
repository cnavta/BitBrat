import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import { logger } from '../common/logging';
import { INTERNAL_INGRESS_V1, InternalEventV1 } from '../types/events';
import { AttributeMap, createMessageSubscriber } from '../services/message-bus';

const SERVICE_NAME = process.env.SERVICE_NAME || 'event-router';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: async (_app: Express, cfg) => {
      // Subscribe to ingress topic and log message contents
      const subject = `${cfg.busPrefix || ''}${INTERNAL_INGRESS_V1}`;
      const sub = createMessageSubscriber();
      logger.info('event_router.subscribe.start', { subject, queue: 'event-router' });
      try {
        await sub.subscribe(
          subject,
          async (data: Buffer, attributes: AttributeMap) => {
            try {
              const evt = JSON.parse(data.toString('utf8')) as InternalEventV1;
              logger.info('event_router.ingress.received', {
                subject,
                type: evt?.type,
                correlationId: evt?.envelope?.correlationId,
                attrs: attributes || {},
                bytes: data?.length || 0,
              });
            } catch (e: any) {
              logger.error('event_router.ingress.parse_error', { subject, error: e?.message || String(e) });
            }
          },
          { queue: 'event-router', ack: 'auto' }
        );
        logger.info('event_router.subscribe.ok', { subject, queue: 'event-router' });
      } catch (e: any) {
        logger.error('event_router.subscribe.error', { subject, error: e?.message || String(e) });
      }
    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[event-router] listening on port ' + PORT);
  });
}
