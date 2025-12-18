import { ProviderRegistry } from './provider-registry';
import type { OAuthProvider, TokenPayload } from './types';

class DummyProvider implements OAuthProvider {
  readonly key = 'dummy';
  readonly displayName = 'Dummy';
  async getAuthorizeUrl(): Promise<string> { return 'https://example.com/auth'; }
  async exchangeCodeForToken(): Promise<TokenPayload> { return { accessToken: 'x' }; }
}

describe('ProviderRegistry', () => {
  it('registers and resolves a provider by key', async () => {
    const reg = new ProviderRegistry();
    const p = new DummyProvider();
    reg.register(p);
    const resolved = reg.resolve('DUMMY');
    expect(resolved).toBe(p);
    expect(reg.has('dummy')).toBe(true);
    expect(reg.listKeys()).toContain('dummy');
  });

  it('throws on unknown provider', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.resolve('missing')).toThrow(/unknown_provider:missing/);
  });
});
