import { TwitchConnectorAdapter } from '../connector-adapter';
import type { ITwitchIrcClient, TwitchIrcDebugSnapshot } from '../twitch-irc-client';

describe('TwitchConnectorAdapter', () => {
  let adapter: TwitchConnectorAdapter;
  let mockClient: jest.Mocked<ITwitchIrcClient>;

  beforeEach(() => {
    mockClient = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn().mockReturnValue({
        state: 'CONNECTED',
        userId: 'test-user-id',
        displayName: 'TestBot',
        joinedChannels: ['#test-channel'],
        counters: { received: 10, published: 10, failed: 0 },
        reconnects: 0,
        lastMessageAt: new Date().toISOString(),
      } as TwitchIrcDebugSnapshot),
      sendText: jest.fn().mockResolvedValue(undefined),
      sendWhisper: jest.fn().mockResolvedValue(undefined),
      banUser: jest.fn().mockResolvedValue(undefined),
    } as any;

    adapter = new TwitchConnectorAdapter(mockClient);
  });

  //
  // Lifecycle Methods
  //

  describe('start()', () => {
    it('should delegate to client.start()', async () => {
      await adapter.start();
      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('should delegate to client.stop()', async () => {
      await adapter.stop();
      expect(mockClient.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSnapshot()', () => {
    it('should delegate to client.getSnapshot() and map state', () => {
      const snapshot = adapter.getSnapshot();

      expect(mockClient.getSnapshot).toHaveBeenCalledTimes(1);
      expect(snapshot.state).toBe('CONNECTED');
      expect(snapshot.id).toBe('test-user-id');
      expect(snapshot.displayName).toBe('TestBot');
      expect(snapshot.joinedChannels).toEqual(['#test-channel']);
    });

    it('should map CONNECTING state correctly', () => {
      mockClient.getSnapshot.mockReturnValue({
        state: 'CONNECTING',
        userId: 'test-id',
        displayName: 'Test',
        joinedChannels: [],
      } as TwitchIrcDebugSnapshot);

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('CONNECTING');
    });

    it('should map RECONNECTING to CONNECTING', () => {
      mockClient.getSnapshot.mockReturnValue({
        state: 'RECONNECTING',
        userId: 'test-id',
        displayName: 'Test',
        joinedChannels: [],
      } as TwitchIrcDebugSnapshot);

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('CONNECTING');
    });

    it('should map DISCONNECTED state correctly', () => {
      mockClient.getSnapshot.mockReturnValue({
        state: 'DISCONNECTED',
        userId: 'test-id',
        displayName: 'Test',
        joinedChannels: [],
      } as TwitchIrcDebugSnapshot);

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('DISCONNECTED');
    });

    it('should map ERROR state correctly', () => {
      mockClient.getSnapshot.mockReturnValue({
        state: 'ERROR',
        userId: 'test-id',
        displayName: 'Test',
        joinedChannels: [],
        lastError: { message: 'Connection failed' },
      } as TwitchIrcDebugSnapshot);

      const snapshot = adapter.getSnapshot();
      expect(snapshot.state).toBe('ERROR');
      expect(snapshot.lastError).toEqual({ message: 'Connection failed' });
    });
  });

  //
  // Egress Methods
  //

  describe('sendText()', () => {
    it('should delegate to client.sendText() with correct parameters', async () => {
      await adapter.sendText('Hello world', '#test-channel');

      expect(mockClient.sendText).toHaveBeenCalledTimes(1);
      expect(mockClient.sendText).toHaveBeenCalledWith('Hello world', '#test-channel');
    });

    it('should handle missing target parameter', async () => {
      await adapter.sendText('Hello world');

      expect(mockClient.sendText).toHaveBeenCalledTimes(1);
      expect(mockClient.sendText).toHaveBeenCalledWith('Hello world', undefined);
    });

    it('should handle client without sendText method', async () => {
      const clientWithoutSendText = { ...mockClient, sendText: undefined };
      const adapterNoSendText = new TwitchConnectorAdapter(clientWithoutSendText as any);

      await expect(adapterNoSendText.sendText('test', '#channel')).resolves.toBeUndefined();
    });
  });

  describe('sendWhisper()', () => {
    it('should delegate to client.sendWhisper() with correct parameters', async () => {
      await adapter.sendWhisper('Secret message', 'user123');

      expect(mockClient.sendWhisper).toHaveBeenCalledTimes(1);
      expect(mockClient.sendWhisper).toHaveBeenCalledWith('Secret message', 'user123');
    });

    it('should handle client without sendWhisper method', async () => {
      const clientWithoutWhisper = { ...mockClient, sendWhisper: undefined };
      const adapterNoWhisper = new TwitchConnectorAdapter(clientWithoutWhisper as any);

      await expect(adapterNoWhisper.sendWhisper('test', 'user')).resolves.toBeUndefined();
    });
  });

  describe('banUser()', () => {
    it('should call banUser when method exists on client', async () => {
      // banUser is added to client dynamically, so we test it exists via (client as any)
      await adapter.banUser('user123');

      // Verify the mock was called (banUser is on mockClient via the 'as any' cast)
      expect((mockClient as any).banUser).toHaveBeenCalledTimes(1);
      expect((mockClient as any).banUser).toHaveBeenCalledWith('user123', undefined);
    });

    it('should pass reason parameter when provided', async () => {
      await adapter.banUser('user123', 'Spam');

      expect((mockClient as any).banUser).toHaveBeenCalledTimes(1);
      expect((mockClient as any).banUser).toHaveBeenCalledWith('user123', 'Spam');
    });

    it('should handle client without banUser method gracefully', async () => {
      const clientWithoutBan = { ...mockClient };
      delete (clientWithoutBan as any).banUser;
      const adapterNoBan = new TwitchConnectorAdapter(clientWithoutBan as any);

      // Should not throw, just silently skip
      await expect(adapterNoBan.banUser('user123')).resolves.toBeUndefined();
    });
  });

  //
  // Metadata
  //

  describe('getMetadata()', () => {
    it('should return correct platform metadata', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.platform).toBe('twitch');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.authMethod).toBe('oauth2');
    });

    it('should return correct ingress capabilities', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.ingress.method).toBe('websocket');
      expect(metadata.capabilities.ingress.realtime).toBe(true);
      expect(metadata.capabilities.ingress.requiresWebhook).toBe(false);
      expect(metadata.capabilities.ingress.requiresPublicUrl).toBe(false);
    });

    it('should return correct egress capabilities', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.egress.chat).toBe(true);
      expect(metadata.capabilities.egress.dm).toBe(true);
      expect(metadata.capabilities.egress.reactions).toBe(false);
      expect(metadata.capabilities.egress.threads).toBe(false);
    });

    it('should return correct moderation capabilities', () => {
      const metadata = adapter.getMetadata();

      expect(metadata.capabilities.moderation.ban).toBe(true);
      expect(metadata.capabilities.moderation.timeout).toBe(true);
      expect(metadata.capabilities.moderation.delete).toBe(true);
    });
  });
});
