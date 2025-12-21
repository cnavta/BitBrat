import { FirestoreTwitchCredentialsProvider } from '../credentials-provider';
import { IConfig } from '../../../../types';

// Mock FirestoreTokenStore
jest.mock('../../../firestore-token-store', () => {
  return {
    FirestoreTokenStore: jest.fn().mockImplementation((path: string) => {
      return {
        path,
        getToken: jest.fn(),
        setToken: jest.fn(),
      };
    }),
  };
});

import { FirestoreTokenStore } from '../../../firestore-token-store';

describe('FirestoreTwitchCredentialsProvider Token Overwrite Repro', () => {
  let provider: FirestoreTwitchCredentialsProvider;
  let mockConfig: IConfig;
  let botStore: any;
  let broadcasterStore: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      twitchBotUsername: 'bot_user',
      tokenDocPath: 'oauth/twitch/bot',
    } as any;

    provider = new FirestoreTwitchCredentialsProvider(mockConfig);
    
    // Access the internal stores (hacky but for test)
    botStore = (provider as any).store;
    broadcasterStore = (provider as any).broadcasterStore;
  });

  it('does NOT overwrite bot userId when saving a refreshed token with broadcaster ID (aliased)', async () => {
    // 1. Setup: Bot token has userId "bot-123"
    botStore.getToken.mockResolvedValue({
      accessToken: 'bot-access',
      refreshToken: 'bot-refresh',
      userId: 'bot-123',
    });

    // 2. Initial load
    await provider.getChatAuth('bot_user');

    // 3. Simulate a refresh happening for an aliased token (broadcaster ID "broadcaster-456")
    // but containing the refreshed bot token data.
    const refreshedBotToken = {
      accessToken: 'new-bot-access',
      refreshToken: 'new-bot-refresh',
      userId: 'broadcaster-456', // This is what Twurple passes back if aliased
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      scope: ['chat'],
    };

    await provider.saveRefreshedToken(refreshedBotToken);

    // 4. Verify that botStore.setToken was called with the ORIGINAL bot userId, not the aliased one
    expect(botStore.setToken).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'bot-123'
    }));
    
    // Verify it was NOT called with the broadcaster ID
    expect(botStore.setToken).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'broadcaster-456'
    }));
  });

  it('saves to broadcasterStore when userId matches broadcasterId', async () => {
    // 1. Setup: Load both tokens
    botStore.getToken.mockResolvedValue({ userId: 'bot-123', accessToken: 'bot-at' });
    broadcasterStore.getToken.mockResolvedValue({ userId: 'broadcaster-456', accessToken: 'broad-at' });

    await provider.getChatAuth('bot_user');
    await provider.getBroadcasterAuth('broadcaster_user');

    // 2. Simulate real broadcaster token refresh
    const refreshedBroadcasterToken = {
      accessToken: 'new-broad-at',
      userId: 'broadcaster-456',
    };

    await provider.saveRefreshedToken(refreshedBroadcasterToken as any);

    // 3. Verify it went to broadcasterStore
    expect(broadcasterStore.setToken).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'broadcaster-456'
    }));
    expect(botStore.setToken).not.toHaveBeenCalled();
  });
});
