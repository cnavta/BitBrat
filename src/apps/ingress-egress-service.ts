import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import { TwitchIrcClient, TwitchEnvelopeBuilder, ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from '../services/ingress/twitch';
import { createTwitchIngressPublisherFromConfig } from '../services/ingress/twitch';
import { buildConfig } from '../common/config';
import {logger} from '../common/logging';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
// Use centralized configuration for port instead of reading env directly in app code
const PORT = buildConfig(process.env).port;

export function createApp() {
  // We'll initialize instances inside BaseServer.setup() where we have the typed Config
  let twitchClient: TwitchIrcClient | null = null;

  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    readinessCheck: () => (twitchClient ? twitchClient.getSnapshot().state === 'CONNECTED' : false),
    setup: (app: Express, cfg) => {
      // Create instances using centralized Config
      logger.debug('Creating Twitch ingress service', {cfg})
      const envelopeBuilder = new TwitchEnvelopeBuilder();
      const publisher = createTwitchIngressPublisherFromConfig(cfg);
      const credsProvider = cfg.firestoreEnabled
        ? new FirestoreTwitchCredentialsProvider(cfg)
        : new ConfigTwitchCredentialsProvider(cfg);

      // Create the IRC client using config-driven channels
      twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, { cfg, credentialsProvider: credsProvider });

      // Start the client (will be a no-op connection in tests)
      twitchClient.start?.().catch((e) => {
        // eslint-disable-next-line no-logger
        logger.error('[ingress-egress] twitchClient.start error', e?.message || e);
      });

      // Debug endpoint exposes current snapshot
      app.get('/_debug/twitch', (_req: Request, res: Response) => {
        const snapshot = twitchClient!.getSnapshot();
        res.status(200).json({ snapshot });
      });
    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    logger.info('[ingress-egress] listening on port ' + PORT);
  });
}
