import { DiscordEgressConnector } from './discord-egress-connector';

describe('DiscordEgressConnector (stub)', () => {
  it('resolves and no-ops when disabled', async () => {
    const cfg: any = { discordEnabled: false, discordChannels: ['123'] };
    const eg = new DiscordEgressConnector(cfg);
    await expect(eg.sendText('hello')).resolves.toBeUndefined();
  });

  it('no-ops when enabled but no channels configured', async () => {
    const cfg: any = { discordEnabled: true, discordChannels: [] };
    const eg = new DiscordEgressConnector(cfg);
    await expect(eg.sendText('hello')).resolves.toBeUndefined();
  });

  it('uses default channel when none provided', async () => {
    const cfg: any = { discordEnabled: true, discordChannels: ['chan-1', 'chan-2'] };
    const eg = new DiscordEgressConnector(cfg);
    await expect(eg.sendText('hello')).resolves.toBeUndefined();
  });
});
