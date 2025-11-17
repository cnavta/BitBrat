import express, { Request, Response } from 'express';

const SERVICE_NAME = process.env.SERVICE_NAME || 'oauth-flow';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

function ensureRequiredEnv() {
  const required = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'OAUTH_STATE_SECRET'];
  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[oauth-flow] Missing required environment variables: ${missing.join(', ')}. ` +
        'These are bound from Secret Manager via Cloud Run. Check secret names/versions and service config.'
    );
    process.exit(1);
  }
}

function buildHealthBody() {
  return {
    status: 'ok',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
  };
}

export function createApp() {
  const app = express();

  // Liveness: process is up
  app.get('/livez', (_req: Request, res: Response) => {
    res.status(200).json(buildHealthBody());
  });

  // Readiness: for now, always ready once app is created; extend in later sprints
  app.get('/readyz', (_req: Request, res: Response) => {
    res.status(200).json(buildHealthBody());
  });

  // Health: generic
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json(buildHealthBody());
  });

  // Root landing for quick sanity
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ message: `${SERVICE_NAME} up`, ...buildHealthBody() });
  });

  return app;
}

if (require.main === module) {
  ensureRequiredEnv();
  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
  });
}
