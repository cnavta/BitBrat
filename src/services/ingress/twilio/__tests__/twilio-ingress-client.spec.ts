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
      updateToken: jest.fn().mockResolvedValue(undefined)
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

  it('stops and shuts down the client', async () => {
    await client.start();
    await client.stop();
    
    expect(mockTwilioClient.shutdown).toHaveBeenCalled();
    expect(client.getSnapshot().state).toBe('DISCONNECTED');
  });
});
