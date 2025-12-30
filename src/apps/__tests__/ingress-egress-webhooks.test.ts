import request from 'supertest';
import { IngressEgressServer } from '../ingress-egress-service';
import { logger } from '../../common/logging';
import twilio from 'twilio';
import { resetConfig } from '../../common/config';

// Mock twilio
jest.mock('twilio', () => {
  const mockCreate = jest.fn();
  const mockParticipants = {
    create: mockCreate
  };
  const mockConversations = jest.fn().mockReturnValue({
    participants: mockParticipants
  });
  
  const client: any = {
    conversations: {
      v1: {
        conversations: mockConversations
      }
    }
  };

  const twilioMock: any = jest.fn().mockReturnValue(client);
  twilioMock.validateRequest = jest.fn().mockReturnValue(true);
  
  // Expose mocks for expectations
  (twilioMock as any)._mockCreate = mockCreate;
  (twilioMock as any)._mockConversations = mockConversations;
  
  return twilioMock;
});

describe('IngressEgressServer Twilio Webhooks', () => {
  let server: IngressEgressServer;
  let app: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetConfig();
    
    // Setup env
    process.env.TWILIO_ENABLED = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.TWILIO_API_KEY = 'SK123';
    process.env.TWILIO_API_SECRET = 'secret';
    process.env.TWILIO_CHAT_SERVICE_SID = 'IS123';
    process.env.TWILIO_IDENTITY = 'BotUser';
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '1';

    server = new IngressEgressServer();
    app = server.getApp();
    
    // Increase delay for async setup
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await server.stop();
  });

  it('handles onConversationAdded by injecting the bot', async () => {
    const payload = {
      EventType: 'onConversationAdded',
      ConversationSid: 'CH123'
    };

    const res = await request(app)
      .post('/webhooks/twilio')
      .set('X-Twilio-Signature', 'valid-sig')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    const twilioMock = twilio as any;
    expect(twilioMock.validateRequest).toHaveBeenCalled();
    expect(twilioMock._mockConversations).toHaveBeenCalledWith('CH123');
    expect(twilioMock._mockCreate).toHaveBeenCalledWith({ identity: 'BotUser' });
  });

  it('handles onMessageAdded by injecting the bot (fallback logic)', async () => {
    const payload = {
      EventType: 'onMessageAdded',
      ConversationSid: 'CH456',
      Body: 'Hello bot'
    };

    const res = await request(app)
      .post('/webhooks/twilio')
      .set('X-Twilio-Signature', 'valid-sig')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    const twilioMock = twilio as any;
    expect(twilioMock._mockConversations).toHaveBeenCalledWith('CH456');
    expect(twilioMock._mockCreate).toHaveBeenCalledWith({ identity: 'BotUser' });
  });

  it('handles "already participant" error gracefully', async () => {
    const twilioMock = twilio as any;
    twilioMock._mockCreate.mockRejectedValueOnce({
      code: 50433,
      message: 'Member already exists'
    });

    const payload = {
      EventType: 'onMessageAdded',
      ConversationSid: 'CH789'
    };

    const res = await request(app)
      .post('/webhooks/twilio')
      .set('X-Twilio-Signature', 'valid-sig')
      .send(payload);

    expect(res.status).toBe(200); // Should still return 200
    expect(twilioMock._mockCreate).toHaveBeenCalled();
  });

  it('rejects invalid signatures', async () => {
    (twilio.validateRequest as jest.Mock).mockReturnValueOnce(false);

    const res = await request(app)
      .post('/webhooks/twilio')
      .set('X-Twilio-Signature', 'wrong-sig')
      .send({ EventType: 'onConversationAdded' });

    expect(res.status).toBe(403);
    expect(twilio as any).not.toHaveBeenCalled(); // Rest client shouldn't be called
  });
});
