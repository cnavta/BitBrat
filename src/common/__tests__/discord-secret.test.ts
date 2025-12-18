import { BaseServer } from '../base-server';

describe('BaseServer Required Env with Discord Bot Token', () => {
  it('identifies DISCORD_BOT_TOKEN as a required secret for ingress-egress', () => {
    const required = BaseServer.computeRequiredKeysFromArchitecture('ingress-egress');
    expect(required).toContain('DISCORD_BOT_TOKEN');
  });
});
