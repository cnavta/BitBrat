import { Firestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { Logger } from '../../common/logging';

export interface TokenInfo {
  token_hash: string;
  user_id: string;
  expires_at?: Date | null;
  created_at: Date;
  last_used_at?: Date | null;
}

export class AuthService {
  private cache: Map<string, { user_id: string; expires_at?: Date | null }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly firestore: Firestore,
    private readonly logger: Logger
  ) {}

  /**
   * Validates a bearer token.
   * 1. Hashes the token using SHA-256.
   * 2. Checks local cache.
   * 3. If not in cache, queries Firestore.
   * 4. Updates cache and last_used_at.
   */
  public async validateToken(token: string): Promise<string | null> {
    if (!token) return null;

    const hash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Check cache
    const cached = this.cache.get(hash);
    if (cached) {
      if (cached.expires_at && cached.expires_at.getTime() < Date.now()) {
        this.cache.delete(hash);
        this.logger.warn('auth.token_expired.cache', { hash: hash.substring(0, 8) });
        return null;
      }
      return cached.user_id;
    }

    // Query Firestore
    try {
      const tokenDoc = await this.firestore.collection('gateways/api/tokens').doc(hash).get();
      
      if (!tokenDoc.exists) {
        this.logger.warn('auth.token_not_found', { hash: hash.substring(0, 8) });
        return null;
      }

      const data = tokenDoc.data();
      if (!data) return null;

      const expires_at = data.expires_at ? data.expires_at.toDate() : null;
      const user_id = data.user_id;

      if (expires_at && expires_at.getTime() < Date.now()) {
        this.logger.warn('auth.token_expired.db', { user_id, hash: hash.substring(0, 8) });
        return null;
      }

      // Update cache
      this.cache.set(hash, { user_id, expires_at });
      setTimeout(() => this.cache.delete(hash), this.CACHE_TTL_MS);

      // Async update last_used_at
      tokenDoc.ref.update({ last_used_at: new Date() }).catch(err => {
        this.logger.error('auth.update_last_used_failed', { error: err.message, user_id });
      });

      return user_id;
    } catch (err: any) {
      this.logger.error('auth.validate_token_error', { error: err.message });
      return null;
    }
  }
}
