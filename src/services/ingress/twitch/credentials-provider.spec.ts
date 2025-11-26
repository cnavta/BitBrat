import { EnvTwitchCredentialsProvider } from './credentials-provider';

describe('EnvTwitchCredentialsProvider', () => {
  it('returns credentials from env', async () => {
    const provider = new EnvTwitchCredentialsProvider({
      TWITCH_BOT_ACCESS_TOKEN: 'tok',
      TWITCH_BOT_USER_ID: 'uid1',
      TWITCH_BOT_USERNAME: 'botuser',
    } as any);
    const auth = await provider.getChatAuth('ignored');
    expect(auth).toEqual({ accessToken: 'tok', userId: 'uid1', login: 'botuser' });
  });

  it('throws if missing any required field', async () => {
    const provider = new EnvTwitchCredentialsProvider({} as any);
    await expect(provider.getChatAuth('chan')).rejects.toThrow('missing token');
  });
});
