import request from 'supertest';
import { createServer, StateEngineServer } from './state-engine';

describe('generated service', () => {
  const server = createServer();
  const app = server.getApp();

  afterAll(async () => {
    await server.close('test');
  });
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  it('allows wildcard disposition state keys', async () => {
    const server = new StateEngineServer();
    expect((server as any).isAllowedKey('user.disposition.user-123')).toBe(true);
    expect((server as any).isAllowedKey('user.profile.user-123')).toBe(false);
    await server.close('test');
  });

  it('allows wildcard user.fact keys (so personal facts can be stored)', async () => {
    const server = new StateEngineServer();
    expect((server as any).isAllowedKey('user.fact.user-123.music')).toBe(true);
    await server.close('test');
  });

  describe('propose_mutation tool', () => {
    const getToolHandler = (server: StateEngineServer, name: string) =>
      (server as any).registeredTools.get(name)?.handler as (args: any) => Promise<any>;

    it('rejects a disallowed key with an error result instead of a false-positive success', async () => {
      const server = new StateEngineServer();
      const handler = getToolHandler(server, 'propose_mutation');
      const result = await handler({ key: 'user.profile.favorite_band', value: 'Yes', reason: 'store a fact' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not in an allowed namespace');
      expect(result.content[0].text).toContain('nothing was stored');
      await server.close('test');
    });

    it('publishes a mutation for an allowed user.fact key', async () => {
      const server = new StateEngineServer();
      const published: any[] = [];
      const fakePublisher = { create: (_subject: string) => ({ publishJson: async (m: any) => { published.push(m); } }) };
      (server as any).getResource = (name: string) => (name === 'publisher' ? fakePublisher : undefined);
      const handler = getToolHandler(server, 'propose_mutation');
      const result = await handler({ key: 'user.fact.user-123.favorite_band', value: 'Yes', reason: 'store a fact' });
      expect(result.isError).toBeFalsy();
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ key: 'user.fact.user-123.favorite_band', value: 'Yes', op: 'set' });
      await server.close('test');
    });
  });

});
