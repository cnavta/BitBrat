import { TwilioIngressClient } from '../twilio-ingress-client';
import { TwilioTokenProvider } from '../token-provider';
import { TwilioEnvelopeBuilder } from '../twilio-envelope-builder';
import { ITwilioIngressPublisher } from '../publisher';
import { IConfig } from '../../../../types';

// Mock the Twilio Conversations SDK
jest.mock('@twilio/conversations', () => ({
  Client: {
    create: jest.fn()
  }
}));

describe('TwilioIngressClient', () => {
  let client: TwilioIngressClient;
  let mockConfig: Partial<IConfig>;
  let mockTokenProvider: jest.Mocked<TwilioTokenProvider>;
  let mockBuilder: jest.Mocked<TwilioEnvelopeBuilder>;
  let mockPublisher: jest.Mocked<ITwilioIngressPublisher>;
  let mockTwilioClient: any;

  beforeEach(() => {
    mockConfig = {
      twilioEnabled: true,
      twilioIdentity: 'bot-identity'
    };
    mockTokenProvider = {
      generateToken: jest.fn().mockReturnValue('mock-token')
    } as any;
    mockBuilder = {
      build: jest.fn().mockReturnValue({ correlationId: 'c1' })
    } as any;
    mockPublisher = {
      publish: jest.fn().mockResolvedValue('msg-id')
    } as any;
    
    mockTwilioClient = {
      on: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getConversationBySid: jest.fn(),
      updateToken: jest.fn().mockResolvedValue(undefined),
      getSubscribedConversations: jest.fn().mockResolvedValue({ items: [] })
    };

    const { Client } = require('@twilio/conversations');
    Client.create.mockResolvedValue(mockTwilioClient);

    client = new TwilioIngressClient(
      mockConfig as IConfig,
      mockTokenProvider,
      mockBuilder,
      mockPublisher
    );
  });

  it('starts successfully and listens for messages', async () => {
    await client.start();
    
    expect(client.getSnapshot().state).toBe('CONNECTED');
    expect(mockTwilioClient.on).toHaveBeenCalledWith('messageAdded', expect.any(Function));
    expect(client.getSnapshot().conversations).toEqual([]);
  });

  it('handles incoming messages and publishes them', async () => {
    await client.start();
    
    // Get the messageAdded handler
    const handler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'messageAdded')[1];
    
    const mockMessage = {
      sid: 'IM123',
      author: 'someone-else',
      body: 'Hello',
      conversation: { sid: 'CH456' }
    };

    await handler(mockMessage);

    expect(mockBuilder.build).toHaveBeenCalledWith(mockMessage);
    expect(mockPublisher.publish).toHaveBeenCalled();
    expect(client.getSnapshot().counters?.published).toBe(1);
  });

  it('ignores messages from itself', async () => {
    await client.start();
    
    const handler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'messageAdded')[1];
    
    const mockMessage = {
      sid: 'IM123',
      author: 'bot-identity', // Matches config.twilioIdentity
      body: 'I said this',
      conversation: { sid: 'CH456' }
    };

    await handler(mockMessage);

    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('sends text successfully', async () => {
    await client.start();
    
    const mockConversation = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };
    mockTwilioClient.getConversationBySid.mockResolvedValue(mockConversation);

    await client.sendText('Hello', 'CH123');

    expect(mockTwilioClient.getConversationBySid).toHaveBeenCalledWith('CH123');
    expect(mockConversation.sendMessage).toHaveBeenCalledWith('Hello');
  });

  it('joins invited conversations on start', async () => {
    const mockInvitedConv = {
      sid: 'CH_INVITED',
      status: 'invited',
      join: jest.fn().mockResolvedValue(undefined)
    };
    mockTwilioClient.getSubscribedConversations.mockResolvedValue({ items: [mockInvitedConv] });
    
    await client.start();
    
    // Trigger synchronization
    const stateHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'stateChanged')[1];
    await stateHandler('synchronized');

    expect(mockInvitedConv.join).toHaveBeenCalled();
  });

  it('handles conversationJoined and updates status', async () => {
    await client.start();
    
    // Add it first so it's in the snapshot
    const addedHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationAdded')[1];
    const mockConv = { sid: 'CH_JOIN', status: 'invited', join: jest.fn().mockResolvedValue(undefined) };
    await addedHandler(mockConv);

    const joinHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationJoined')[1];
    await joinHandler({ sid: 'CH_JOIN', status: 'joined' });

    const snap = client.getSnapshot();
    const c = snap.conversations?.find(conv => conv.sid === 'CH_JOIN');
    expect(c?.status).toBe('joined');
  });

  it('handles conversationUpdated and updates snapshot', async () => {
    await client.start();
    
    const addedHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationAdded')[1];
    await addedHandler({ sid: 'CH_UPDATE', status: 'joined', friendlyName: 'Old Name' });

    const updateHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationUpdated')[1];
    await updateHandler({ 
      conversation: { sid: 'CH_UPDATE', status: 'joined', friendlyName: 'New Name' },
      updateReasons: ['friendlyName']
    });

    const snap = client.getSnapshot();
    const c = snap.conversations?.find(conv => conv.sid === 'CH_UPDATE');
    expect(c?.friendlyName).toBe('New Name');
  });

  it('handles participantJoined for the bot', async () => {
    await client.start();
    
    const handler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'participantJoined')[1];
    const mockParticipant = {
      identity: 'bot-identity',
      sid: 'PA123',
      conversation: { sid: 'CH123' }
    };

    await handler(mockParticipant);
    // Should log and proceed (we can't easily check logs here without mocking logger, but we verify it doesn't crash)
  });

  it('joins invited conversations when added later', async () => {
    await client.start();
    
    const addedHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationAdded')[1];
    const mockInvitedConv = {
      sid: 'CH_LATER',
      status: 'invited',
      join: jest.fn().mockResolvedValue(undefined)
    };
    
    await addedHandler(mockInvitedConv);
    expect(mockInvitedConv.join).toHaveBeenCalled();
  });

  it('tracks conversations in the snapshot', async () => {
    await client.start();
    
    const addedHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationAdded')[1];
    const mockConv = {
      sid: 'CH_NEW',
      status: 'joined',
      friendlyName: 'New Chat'
    };
    
    await addedHandler(mockConv);
    expect(client.getSnapshot().conversations).toContainEqual({
      sid: 'CH_NEW',
      status: 'joined',
      friendlyName: 'New Chat'
    });

    const removedHandler = mockTwilioClient.on.mock.calls.find((c: any) => c[0] === 'conversationRemoved')[1];
    await removedHandler(mockConv);
    expect(client.getSnapshot().conversations).not.toContainEqual(expect.objectContaining({ sid: 'CH_NEW' }));
  });

  it('stops and shuts down the client', async () => {
    await client.start();
    await client.stop();
    
    expect(mockTwilioClient.shutdown).toHaveBeenCalled();
    expect(client.getSnapshot().state).toBe('DISCONNECTED');
  });
});
