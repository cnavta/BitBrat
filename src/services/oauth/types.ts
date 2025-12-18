// OAuth shared types and provider interface

export type TokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO timestamp
  scope?: string[];
  tokenType?: string; // e.g., "oauth" | "bot-token"
  providerUserId?: string;
  metadata?: Record<string, unknown>;
};

export type ValidationResult = {
  valid: boolean;
  reason?: string;
  expiresAt?: string;
  scope?: string[];
  providerUserId?: string;
};

export interface OAuthProvider {
  readonly key: string; // "twitch" | "discord" | …
  readonly displayName: string;
  getAuthorizeUrl(params: {
    identity: string;
    state: string;
    mode?: 'json' | 'redirect';
    scopes?: string[];
    redirectUri?: string;
  }): Promise<string>;
  exchangeCodeForToken(params: { code: string; redirectUri: string; identity: string }): Promise<TokenPayload>;
  refreshAccessToken?(token: TokenPayload): Promise<TokenPayload>;
  validateToken?(token: TokenPayload): Promise<ValidationResult>;
  revokeToken?(token: TokenPayload): Promise<void>;
}
