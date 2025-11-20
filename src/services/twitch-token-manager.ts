import { ITokenStore, TwitchTokenData } from '../types';
import { logger } from '../common/logging';

export interface TwitchTokenManagerOptions {
  clientId: string;
  clientSecret: string;
  tokenStore: ITokenStore;
  skewSeconds?: number; // preemptive refresh window
}

export class TwitchTokenManager {
  private skewMs: number;
  private cached: TwitchTokenData | null = null;
  private refreshing: Promise<TwitchTokenData | null> | null = null;

  constructor(private opts: TwitchTokenManagerOptions) {
    this.skewMs = Math.max(0, (opts.skewSeconds ?? 120) * 1000);
  }

  async getValidAccessToken(): Promise<string | null> {
    try {
      const tok = await this.getValidToken();
      return tok?.accessToken ?? null;
    } catch (e: any) {
      logger.warn('twitch_token_manager.get_valid_failed', { error: e?.message || String(e) });
      return null;
    }
  }

  async getValidToken(): Promise<TwitchTokenData | null> {
    // Load from cache or store
    let token = this.cached ?? (await this.opts.tokenStore.getToken());
    if (!token) return null;

    // If no expiry information, assume valid (Twurple-managed flows should keep it fresh)
    if (!this.isExpiredOrStale(token)) {
      this.cached = token;
      return token;
    }

    // Attempt refresh (de-duped)
    return await this.refreshToken(token);
  }

  async forceRefresh(): Promise<TwitchTokenData | null> {
    const token = this.cached ?? (await this.opts.tokenStore.getToken());
    if (!token) return null;
    return await this.refreshToken(token, true);
  }

  private isExpiredOrStale(t: TwitchTokenData): boolean {
    const obtained = t.obtainmentTimestamp ?? 0;
    const expiresInSec = t.expiresIn ?? 0;
    if (!obtained || !expiresInSec) return false; // treat as non-expiring if unknown
    const expiresAt = obtained + expiresInSec * 1000;
    return Date.now() + this.skewMs >= expiresAt;
  }

  private async refreshToken(current: TwitchTokenData, force: boolean = false): Promise<TwitchTokenData | null> {
    if (!force && this.refreshing) {
      return this.refreshing;
    }
    if (!current.refreshToken) {
      // No refresh token available; cannot refresh
      logger.warn('twitch_token_manager.no_refresh_token');
      this.cached = current;
      return current;
    }
    const doRefresh = async (): Promise<TwitchTokenData | null> => {
      try {
        const params = new URLSearchParams({
          client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken as string,
        });
        const resp = await fetch('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        if (!resp.ok) {
          const body = await resp.text();
          logger.error('twitch_token_manager.refresh_failed', { status: resp.status, body: body?.slice(0,200) });
          // If refresh fails, keep current so caller can decide how to proceed
          return current;
        }
        const json: any = await resp.json();
        const updated: TwitchTokenData = {
          accessToken: json.access_token,
          refreshToken: json.refresh_token ?? current.refreshToken ?? null,
          expiresIn: json.expires_in ?? current.expiresIn ?? null,
          obtainmentTimestamp: Date.now(),
          scope: Array.isArray(json.scope) ? json.scope : current.scope ?? [],
          userId: current.userId ?? null,
        };
        await this.opts.tokenStore.setToken(updated);
        this.cached = updated;
        logger.info('twitch_token_manager.refreshed');
        return updated;
      } catch (e: any) {
        logger.error('twitch_token_manager.refresh_error', { error: e?.message || String(e) });
        return current;
      } finally {
        this.refreshing = null;
      }
    };

    this.refreshing = doRefresh();
    return this.refreshing;
  }
}
