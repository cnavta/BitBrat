import type { Express, Request, Response } from 'express';
import type { IConfig } from '../../types';
import { logger } from '../../common/logging';
import { ProviderRegistry } from './provider-registry';
import type { OAuthProvider } from './types';
import { verifyState } from '../twitch-oauth';

function wantsJson(req: Request): boolean {
  return (req.query as any).mode === 'json' || (req.headers.accept || '').includes('application/json');
}

export function mountOAuthRoutes(app: Express, cfg: IConfig, registry: ProviderRegistry, basePath = '/oauth') {
  const base = basePath.replace(/\/$/, '');

  // Start – returns provider authorize URL (JSON or redirect)
  app.get(`${base}/:provider/:identity/start`, async (req: Request, res: Response) => {
    try {
      const providerKey = String(req.params.provider || '').toLowerCase();
      const identity = String(req.params.identity || '');
      const provider: OAuthProvider = registry.resolve(providerKey);
      const state = require('crypto').randomBytes(8).toString('hex');
      const url = await provider.getAuthorizeUrl({ identity, state, mode: wantsJson(req) ? 'json' : 'redirect' });
      if (wantsJson(req)) return res.status(200).json({ url });
      return res.redirect(302, url);
    } catch (e: any) {
      const msg = e?.message || String(e);
      const code = msg.startsWith('unknown_provider:') ? 404 : 500;
      logger.error('oauth.routes.start.error', { error: msg });
      return res.status(code).json({ error: msg });
    }
  });

  // Callback – validate state and delegate to provider adapter (token persistence wired in later step)
  app.get(`${base}/:provider/:identity/callback`, async (req: Request, res: Response) => {
    try {
      const providerKey = String(req.params.provider || '').toLowerCase();
      const identity = String(req.params.identity || '');
      const { code, state, error } = req.query as Record<string, string>;
      if (error) return res.status(400).send('OAuth error');
      if (!verifyState(cfg, state)) return res.status(400).send('Invalid state');
      if (!code) return res.status(400).send('Missing code');
      const provider: OAuthProvider = registry.resolve(providerKey);
      // Redirect URI resolution is provider-specific; allow adapter to compute when not provided
      const token = await provider.exchangeCodeForToken({ code, redirectUri: '', identity });
      // Persistence to token store will be added with OF-MP-05
      return res.status(200).json({ ok: true, provider: providerKey, identity, stored: false, tokenType: token?.tokenType || 'oauth' });
    } catch (e: any) {
      const msg = e?.message || String(e);
      const code = msg.startsWith('unknown_provider:') ? 404 : 500;
      logger.error('oauth.routes.callback.error', { error: msg });
      return res.status(code).json({ error: 'callback_failed' });
    }
  });

  // Refresh – optional, depends on provider support
  app.post(`${base}/:provider/:identity/refresh`, async (req: Request, res: Response) => {
    try {
      const providerKey = String(req.params.provider || '').toLowerCase();
      const provider: OAuthProvider = registry.resolve(providerKey);
      if (typeof provider.refreshAccessToken !== 'function') return res.status(501).json({ error: 'not_supported' });
      return res.status(501).json({ error: 'not_implemented' });
    } catch (e: any) {
      const msg = e?.message || String(e);
      const code = msg.startsWith('unknown_provider:') ? 404 : 500;
      logger.error('oauth.routes.refresh.error', { error: msg });
      return res.status(code).json({ error: 'refresh_failed' });
    }
  });

  // Status – placeholder for token presence/info (wired with token store in OF-MP-05)
  app.get(`${base}/:provider/:identity/status`, async (_req: Request, res: Response) => {
    return res.status(200).json({ ok: true, status: 'unknown' });
  });
}
