import { mountTwitchOAuthRoutes } from '../services/twitch-oauth';
import { FirestoreTokenStore } from '../services/firestore-token-store';
import { IConfig, ITokenStore } from '../types';
import { assertRequiredSecrets, buildConfig } from '../common/config';
import { BaseServer } from '../common/base-server';
import type { Logger } from '../common/logging';

const SERVICE_NAME = process.env.SERVICE_NAME || 'oauth-flow';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp(options?: { botStore?: ITokenStore; broadcasterStore?: ITokenStore; config?: Partial<IConfig> }) {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    configOverrides: { port: PORT, ...(options?.config || {}) },
    setup: (app, cfg) => {
      try {
        const botStore: ITokenStore = options?.botStore || new FirestoreTokenStore(cfg.tokenDocPath!);
        const broadcasterStore: ITokenStore = options?.broadcasterStore || new FirestoreTokenStore(cfg.broadcasterTokenDocPath!);
        // Mount routes for both identities
        mountTwitchOAuthRoutes(app, cfg, botStore, '/oauth/twitch/bot');
        mountTwitchOAuthRoutes(app, cfg, broadcasterStore, '/oauth/twitch/broadcaster');
      } catch (e) {
        const log: Logger | undefined = (app as any).locals?.logger;
        if (log) {
          log.error('Failed to mount OAuth routes', { error: (e as any)?.message || String(e) });
        } else {
          // eslint-disable-next-line no-console
          console.error('[oauth-flow] Failed to mount OAuth routes', e);
        }
      }
    },
  });
  return server.getApp();
}

if (require.main === module) {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    configOverrides: { port: PORT },
    validateConfig: (cfg) => assertRequiredSecrets(cfg),
    setup: (app, cfg) => {
      try {
        const botStore: ITokenStore = new FirestoreTokenStore(cfg.tokenDocPath!);
        const broadcasterStore: ITokenStore = new FirestoreTokenStore(cfg.broadcasterTokenDocPath!);
        mountTwitchOAuthRoutes(app, cfg, botStore, '/oauth/twitch/bot');
        mountTwitchOAuthRoutes(app, cfg, broadcasterStore, '/oauth/twitch/broadcaster');
      } catch (e) {
        const log: Logger | undefined = (app as any).locals?.logger;
        if (log) {
          log.error('Failed to mount OAuth routes at startup', { error: (e as any)?.message || String(e) });
        } else {
          // eslint-disable-next-line no-console
          console.error('[oauth-flow] Failed to mount OAuth routes at startup', e);
        }
      }
    },
  });
  const cfg: IConfig = buildConfig(process.env, { port: PORT });
  server.start(cfg.port).catch((err) => {
    try {
      (server.getLogger && server.getLogger()).error('failed to start', { error: (err as any)?.message || String(err) });
    } catch {
      // eslint-disable-next-line no-console
      console.error(`[${SERVICE_NAME}] failed to start`, err);
    }
    process.exit(1);
  });
}
