import request from 'supertest';
import { createApp } from './query-analyzer';
import { analyzeWithLlm } from '../services/query-analyzer/llm-provider';

// Mock message-bus to capture and trigger handlers
let capturedHandler: any;
const subscribeMock = jest.fn(async (_subject: string, handler: any, _opts?: any) => {
  capturedHandler = handler;
  return async () => {};
});
const publishJsonMock = jest.fn(async (_data: any) => {});
const createMessageSubscriberMock = jest.fn(() => ({ subscribe: subscribeMock }));
const createMessagePublisherMock = jest.fn(() => ({ publishJson: publishJsonMock }));

jest.mock('../services/message-bus', () => ({
  createMessageSubscriber: () => createMessageSubscriberMock(),
  createMessagePublisher: () => createMessagePublisherMock(),
}));

jest.mock('../services/query-analyzer/llm-provider', () => ({
  analyzeWithLlm: jest.fn(),
}));

// Mock process.env for BaseServer
process.env.BUS_PREFIX = '';

describe('query-analyzer service', () => {
  const app = createApp();

  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  describe('message handling', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('processes a normal message and calls next()', async () => {
      const mockAnalysis = {
        intent: 'question',
        tone: { valence: 0.5, arousal: 0.1 },
        risk: { level: 'none', type: 'none' }
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);

      const event = {
        v: '2',
        correlationId: 'test-123',
        type: 'chat.message.v1',
        message: { text: 'Hello, how are you?' },
        routingSlip: [
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.egress.v1' }
        ],
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      // Ensure the handler was captured during service initialization
      expect(capturedHandler).toBeDefined();

      await capturedHandler(payload, {}, ctx);

      expect(analyzeWithLlm).toHaveBeenCalled();
      expect(publishJsonMock).toHaveBeenCalled();
      
      const published = publishJsonMock.mock.calls[0][0] as any;
      expect(published.annotations).toBeDefined();
      expect(published.annotations.length).toBe(3);
      expect(published.annotations.find((a: any) => a.kind === 'intent').label).toBe('question');
      
      // Check that routing slip was updated and we proceeded to next
      expect(published.routingSlip[0].status).toBe('OK');
      expect(published.type).toBe('chat.message.v1'); // next() doesn't change type by default
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('short-circuits spam messages', async () => {
      const mockAnalysis = {
        intent: 'spam',
        tone: { valence: -0.8, arousal: 0.5 },
        risk: { level: 'high', type: 'spam' }
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);

      const event = {
        v: '2',
        correlationId: 'test-spam',
        type: 'chat.message.v1',
        message: { text: 'BUY CRYPTO NOW!!!' },
        routingSlip: [
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.egress.v1' }
        ],
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalled();
      const published = publishJsonMock.mock.calls[0][0] as any;
      
      // BaseServer.complete() changes type to egress.deliver.v1
      expect(published.type).toBe('egress.deliver.v1');
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('skips analysis for very short messages (< 3 tokens)', async () => {
      const event = {
        v: '2',
        correlationId: 'test-short',
        type: 'chat.message.v1',
        message: { text: 'Hi' }, // 1 token
        routingSlip: [
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' }
        ],
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(analyzeWithLlm).not.toHaveBeenCalled();
      expect(publishJsonMock).toHaveBeenCalled();
      
      const published = publishJsonMock.mock.calls[0][0] as any;
      expect(published.routingSlip[0].status).toBe('OK');
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('falls back to next() on LLM failure', async () => {
      (analyzeWithLlm as jest.Mock).mockResolvedValue(null);

      const event = {
        v: '2',
        correlationId: 'test-fail',
        message: { text: 'test' },
        routingSlip: [
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' }
        ],
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalled();
      expect(ctx.ack).toHaveBeenCalled();
    });
  });
});
