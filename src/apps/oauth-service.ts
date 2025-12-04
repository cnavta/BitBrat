import { mountTwitchOAuthRoutes } from '../services/twitch-oauth';
import { FirestoreTokenStore } from '../services/firestore-token-store';
import { IConfig, ITokenStore } from '../types';
import { assertRequiredSecrets, buildConfig } from '../common/config';
import { BaseServer } from '../common/base-server';
import type { Logger } from '../common/logging';
import type { Firestore } from 'firebase-admin/firestore';

// Avoid direct env usage in app code; use a stable service name and central Config for port
const SERVICE_NAME = 'oauth-flow';

class OauthServer extends BaseServer {
  constructor(private readonly options?: { botStore?: ITokenStore; broadcasterStore?: ITokenStore; config?: Partial<IConfig> }) {
    super({
      serviceName: SERVICE_NAME,
      configOverrides: { ...((options && options.config) || {}) },
    });
    // Perform setup after BaseServer is constructed
    this.setupApp(this.getApp() as any, this.getConfig());
  }

  private setupApp(app: any, cfg: IConfig) {
    try {
      const db = this.getResource<Firestore>('firestore');
      const botStore: ITokenStore = this.options?.botStore || new FirestoreTokenStore(cfg.tokenDocPath!, db);
      const broadcasterStore: ITokenStore = this.options?.broadcasterStore || new FirestoreTokenStore(cfg.broadcasterTokenDocPath!, db);
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
  }
}

export function createApp(options?: { botStore?: ITokenStore; broadcasterStore?: ITokenStore; config?: Partial<IConfig> }) {
  const server = new OauthServer(options);
  return server.getApp();
}

if (require.main === module) {
  const server = new OauthServer();
  const cfg: IConfig = buildConfig(process.env);
  // Validate required secrets using the same logic
  try { assertRequiredSecrets(cfg); } catch (e: any) { console.error('[oauth-flow] missing secrets', e?.message || e); process.exit(1); }
  server.start(cfg.port).catch((err) => {
    try {
      server.getLogger().error('failed to start', { error: (err as any)?.message || String(err) });
    } catch {
      // eslint-disable-next-line no-console
      console.error(`[${SERVICE_NAME}] failed to start`, err);
    }
    process.exit(1);
  });
}
