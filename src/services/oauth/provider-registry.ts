import { OAuthProvider } from './types';

export class ProviderRegistry {
  private providers = new Map<string, OAuthProvider>();

  register(provider: OAuthProvider): void {
    const key = provider.key.toLowerCase();
    this.providers.set(key, provider);
  }

  resolve(key: string): OAuthProvider {
    const k = (key || '').toLowerCase();
    const p = this.providers.get(k);
    if (!p) throw new Error(`unknown_provider:${key}`);
    return p;
  }

  has(key: string): boolean {
    return this.providers.has((key || '').toLowerCase());
  }

  listKeys(): string[] {
    return Array.from(this.providers.keys());
  }
}
