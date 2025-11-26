import { ConfigTwitchCredentialsProvider } from './credentials-provider';

describe('ConfigTwitchCredentialsProvider', () => {
  it('returns credentials from config', async () => {
    const provider = new ConfigTwitchCredentialsProvider({
      port: 0,
      logLevel: 'info',
      twitchScopes: [],
      twitchChannels: [],
      twitchBotAccessToken: 'tok',
      twitchBotUserId: 'uid1',
      twitchBotUsername: 'botuser',
    } as any);

    const auth = await provider.getChatAuth('ignored');
    expect(auth).toEqual({ accessToken: 'tok', userId: 'uid1', login: 'botuser' });
  });

  it('throws if missing any required field', async () => {
    const provider = new ConfigTwitchCredentialsProvider({
      port: 0,
      logLevel: 'info',
      twitchScopes: [],
      twitchChannels: [],
    } as any);
    await expect(provider.getChatAuth('chan')).rejects.toThrow('missing token');
  });
});
