import { AuthServer } from '../../src/apps/auth-service';
import { BaseServer } from '../../src/common/base-server';
import { INTERNAL_AUTH_V1, INTERNAL_SYSTEM_EVENTS_V1 } from '../../src/types/events';

// Mock message bus
const publishJsonMock = jest.fn(async () => {});
jest.mock('../../src/services/message-bus', () => ({
  createMessagePublisher: jest.fn(() => ({
    publishJson: publishJsonMock,
  })),
  createMessageSubscriber: () => ({
    subscribe: jest.fn(async () => () => {}),
  }),
}));

describe('AuthServer Event Emission', () => {
  let server: AuthServer;
  let dbMock: any;
  let pubResMock: any;
  let onMessageHandler: any;

  beforeEach(() => {
    jest.clearAllMocks();

    dbMock = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };

    pubResMock = {
      create: jest.fn().mockReturnValue({
        publishJson: publishJsonMock,
      }),
    };

    jest.spyOn(BaseServer.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
      const name = args[0];
      if (name === 'firestore') return dbMock;
      if (name === 'publisher') return pubResMock;
      return undefined;
    });

    // Capture the onMessage handler
    jest.spyOn(BaseServer.prototype as any, 'onMessage').mockImplementation((cfg: any, handler: any) => {
      if (cfg.destination === INTERNAL_AUTH_V1) {
        onMessageHandler = handler;
      }
    });

    server = new AuthServer();
  });

  it('emits system events when isFirstMessage and isNewSession are true', async () => {
    const correlationId = 'corr-123';
    const incomingEvent = {
      v: '2',
      correlationId,
      type: 'chat.message.v1',
      ingress: { source: 'twitch', connector: 'twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      egress: { destination: 'out', connector: 'twitch' },
      routing: { stage: 'initial', slip: [], history: [] },
    };

    // Mock Firestore: user doesn't exist yet
    dbMock.get.mockResolvedValue({ exists: false });

    // Mock next() and ack()
    const nextSpy = jest.spyOn(BaseServer.prototype as any, 'next').mockResolvedValue(undefined);
    const ackMock = jest.fn().mockResolvedValue(undefined);

    await onMessageHandler(incomingEvent, {}, { ack: ackMock });

    // Verify system events published to INTERNAL_SYSTEM_EVENTS_V1
    // One for first_message, one for first_session_message
    expect(publishJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system.user.first_message',
        correlationId,
      }),
      expect.objectContaining({ type: 'system.user.first_message' })
    );

    expect(publishJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system.user.first_session_message',
        correlationId,
      }),
      expect.objectContaining({ type: 'system.user.first_session_message' })
    );

    expect(nextSpy).toHaveBeenCalled();
    expect(ackMock).toHaveBeenCalled();
  });

  it('emits only first_session_message if user exists but it is a new session', async () => {
    const correlationId = 'corr-456';
    const incomingEvent = {
      v: '2',
      correlationId,
      type: 'chat.message.v1',
      ingress: { source: 'twitch', connector: 'twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      egress: { destination: 'out', connector: 'twitch' },
      routing: { stage: 'initial', slip: [], history: [] },
    };

    // Mock Firestore: user exists, messageCount > 0, but last seen long ago
    const dataExisting = {
      id: 'twitch:u1',
      messageCountAllTime: 5,
      lastSessionActivityAt: '2020-01-01T00:00:00Z',
    };
    dbMock.get.mockResolvedValue({
      exists: true,
      data: () => dataExisting,
    });

    const nextSpy = jest.spyOn(BaseServer.prototype as any, 'next').mockResolvedValue(undefined);
    const ackMock = jest.fn().mockResolvedValue(undefined);

    await onMessageHandler(incomingEvent, {}, { ack: ackMock });

    // Should NOT have first_message
    expect(publishJsonMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system.user.first_message' }),
      expect.any(Object)
    );

    // Should have first_session_message
    expect(publishJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system.user.first_session_message',
        correlationId,
      }),
      expect.objectContaining({ type: 'system.user.first_session_message' })
    );
  });
});
