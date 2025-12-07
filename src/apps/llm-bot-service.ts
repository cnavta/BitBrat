import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';

const SERVICE_NAME = process.env.SERVICE_NAME || 'llm-bot';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class LlmBotServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)


    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();

    // Subscribe to the llm-bot input topic and log received messages (JSON assumed)
    await this.onMessage<any>('internal.llmbot.v1', async (data, attributes, ctx) => {
      try {
        const logger = this.getLogger();
        logger.info('llm_bot.received', { message: data, attributes });

        // Create a child span for processing for better trace visibility
        const tracer = (this as any).getTracer?.();
        if (tracer && typeof tracer.startActiveSpan === 'function') {
          await tracer.startActiveSpan('process-llm-request', async (span: any) => {
            try {
              logger.info('llm_bot.processing');
              // ... LLM processing would occur here ...
            } finally {
              span.end();
            }
          });
        }
      } finally {
        await ctx.ack();
      }
    });
  }
}

export function createApp() {
  const server = new LlmBotServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new LlmBotServer();
  void server.start(PORT);
}
