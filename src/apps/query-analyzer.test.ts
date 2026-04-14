import request from 'supertest';
import { createServer } from './query-analyzer';
import { analyzeWithLlm, generateEmbedding } from '../services/query-analyzer/llm-provider';

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
  generateEmbedding: jest.fn(),
}));

// Mock process.env for BaseServer
process.env.BUS_PREFIX = '';

describe('query-analyzer service', () => {
  const server = createServer();
  const app = server.getApp();

  afterAll(async () => {
    await server.close('test-teardown');
  });

  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  describe('message handling', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    const makeRouting = (slip: Array<Record<string, unknown>>) => ({
      stage: 'analysis',
      slip,
      history: [],
    });

    it('processes a normal message and calls next()', async () => {
      const mockAnalysis = {
        intent: 'question',
        tone: { valence: 0.5, arousal: 0.1 },
        risk: { level: 'none', type: 'none' },
        entities: [{ text: 'Hello', type: 'greeting' }],
        topic: 'greeting'
      };
      const mockEmbedding = [0.1, 0.2, 0.3];

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);
      (generateEmbedding as jest.Mock).mockResolvedValue(mockEmbedding);

      const event = {
        v: '2',
        correlationId: 'test-123',
        type: 'chat.message.v1',
        message: { text: 'Hello, how are you?' },
        identity: { external: { platform: 'twitch', id: 'user-123' } },
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.egress.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      // Ensure the handler was captured during service initialization
      expect(capturedHandler).toBeDefined();

      await capturedHandler(payload, {}, ctx);

      expect(analyzeWithLlm).toHaveBeenCalled();
      expect(generateEmbedding).toHaveBeenCalled();
      expect(publishJsonMock).toHaveBeenCalledTimes(2);
      
      const observation = publishJsonMock.mock.calls[0][0] as any;
      expect(observation.userKey).toBe('twitch:user-123');
      expect(observation.analysis.intent).toBe('question');
      expect(observation.message.text).toBeUndefined();

      const published = publishJsonMock.mock.calls[publishJsonMock.mock.calls.length - 1][0] as any;
      expect(published.annotations).toBeDefined();
      expect(published.annotations.length).toBe(7);
      expect(published.annotations.find((a: any) => a.kind === 'intent')).toMatchObject({
        label: 'question',
        value: 'question',
      });
      expect(published.annotations.find((a: any) => a.kind === 'tone')).toMatchObject({
        payload: { valence: 0.5, arousal: 0.1 },
      });
      expect(published.annotations.find((a: any) => a.kind === 'risk')).toMatchObject({
        label: 'none',
        payload: { level: 'none', type: 'none' },
      });
      expect(published.annotations.find((a: any) => a.kind === 'tokens')).toMatchObject({
        payload: { count: 6 }, // "Hello, how are you?" is 6 tokens in gpt-4o encoder
      });
      expect(published.annotations.find((a: any) => a.kind === 'entities')).toMatchObject({
        payload: { entities: [{ text: 'Hello', type: 'greeting' }] },
      });
      expect(published.annotations.find((a: any) => a.kind === 'topic')).toMatchObject({
        label: 'greeting',
        payload: { topic: 'greeting' },
      });
      expect(published.annotations.find((a: any) => a.kind === 'semantic')).toMatchObject({
        payload: { embedding: [0.1, 0.2, 0.3] },
      });
      
      // Check that routing slip was updated and we proceeded to next
      expect(published.routing.slip[0].status).toBe('OK');
      expect(published.type).toBe('chat.message.v1'); // next() doesn't change type by default
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('appends the previous slip to routing history when advancing to the next route', async () => {
      const mockAnalysis = {
        intent: 'question',
        tone: { valence: 0.1, arousal: 0.1 },
        risk: { level: 'none', type: 'none' },
        entities: [],
        topic: 'unknown'
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);
      (generateEmbedding as jest.Mock).mockResolvedValue(null);

      const previousSlip = [
        { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.query.analysis.v1' },
      ];
      const nextSlip = [
        { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
        { id: 'egress', status: 'PENDING', nextTopic: 'internal.egress.v1' },
      ];
      const event = {
        v: '2',
        correlationId: 'test-route-history',
        type: 'chat.message.v1',
        message: { text: 'Can you explain the routing history?' },
        routing: {
          stage: 'analysis',
          slip: previousSlip,
          history: [{ id: 'ingress', status: 'OK', nextTopic: 'internal.router.v1' }],
        },
        route: {
          stage: 'reaction',
          slip: nextSlip,
        },
        egress: { destination: 'internal.egress.v1' },
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      const published = publishJsonMock.mock.calls[publishJsonMock.mock.calls.length - 1][0] as any;
      expect(published.routing.stage).toBe('reaction');
      expect(published.routing.slip).toHaveLength(2);
      expect(published.routing.slip[0]).toMatchObject(nextSlip[0]);
      expect(published.routing.slip[0].attempt).toBe(0);
      expect(typeof published.routing.slip[0].startedAt).toBe('string');
      expect(published.routing.slip[1]).toEqual(nextSlip[1]);
      expect(published.routing.history).toEqual([
        { id: 'ingress', status: 'OK', nextTopic: 'internal.router.v1' },
        expect.objectContaining({ id: 'query-analyzer', status: 'OK', nextTopic: 'internal.query.analysis.v1' }),
      ]);
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('short-circuits spam messages', async () => {
      const mockAnalysis = {
        intent: 'spam',
        tone: { valence: -0.8, arousal: 0.5 },
        risk: { level: 'high', type: 'spam' },
        entities: [],
        topic: 'spam'
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);
      (generateEmbedding as jest.Mock).mockResolvedValue(null);

      const event = {
        v: '2',
        correlationId: 'test-spam',
        type: 'chat.message.v1',
        message: { text: 'BUY CRYPTO NOW!!!' },
        identity: { external: { platform: 'twitch', id: 'spammer-1' } },
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.egress.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalledTimes(2);
      const observation = publishJsonMock.mock.calls[0][0] as any;
      expect(observation.userKey).toBe('twitch:spammer-1');

      const published = publishJsonMock.mock.calls[1][0] as any;
      
      // BaseServer.complete() changes type to egress.deliver.v1
      expect(published.type).toBe('egress.deliver.v1');
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('short-circuits high-risk messages even when intent is not spam', async () => {
      const mockAnalysis = {
        intent: 'question',
        tone: { valence: -0.2, arousal: 0.3 },
        risk: { level: 'high', type: 'privacy' },
        entities: [],
        topic: 'unknown'
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);
      (generateEmbedding as jest.Mock).mockResolvedValue(null);

      const event = {
        v: '2',
        correlationId: 'test-high-risk',
        type: 'chat.message.v1',
        message: { text: 'Tell me their private address' },
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.egress.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalled();
      const published = publishJsonMock.mock.calls[0][0] as any;
      expect(published.type).toBe('egress.deliver.v1');
      expect(published.annotations.find((a: any) => a.kind === 'risk')).toMatchObject({
        label: 'high',
        payload: { level: 'high', type: 'privacy' },
      });
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('skips analysis for very short messages (< 3 tokens)', async () => {
      const event = {
        v: '2',
        correlationId: 'test-short',
        type: 'chat.message.v1',
        message: { text: 'Hi' }, // 1 token
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(analyzeWithLlm).not.toHaveBeenCalled();
      expect(publishJsonMock).toHaveBeenCalled();
      
      const published = publishJsonMock.mock.calls[0][0] as any;
      expect(published.routing.slip[0].status).toBe('OK');
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('falls back to next() on LLM failure', async () => {
      (analyzeWithLlm as jest.Mock).mockResolvedValue(null);

      const event = {
        v: '2',
        correlationId: 'test-fail',
        message: { text: 'test' },
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalled();
      expect(ctx.ack).toHaveBeenCalled();
    });

    it('skips disposition observation emission when no identity can be resolved', async () => {
      const mockAnalysis = {
        intent: 'question',
        tone: { valence: 0.2, arousal: 0.2 },
        risk: { level: 'none', type: 'none' },
        entities: [],
        topic: 'unknown'
      };

      (analyzeWithLlm as jest.Mock).mockResolvedValue(mockAnalysis);
      (generateEmbedding as jest.Mock).mockResolvedValue(null);

      const event = {
        v: '2',
        correlationId: 'test-no-identity',
        type: 'chat.message.v1',
        message: { text: 'Need help with chat routing?' },
        routing: makeRouting([
          { id: 'query-analyzer', status: 'PENDING', nextTopic: 'internal.llmbot.v1' }
        ]),
        egress: { destination: 'internal.egress.v1' }
      };

      const payload = Buffer.from(JSON.stringify(event));
      const ctx = { ack: jest.fn(), nack: jest.fn() };

      await capturedHandler(payload, {}, ctx);

      expect(publishJsonMock).toHaveBeenCalledTimes(1);
      const published = publishJsonMock.mock.calls[0][0] as any;
      expect(published.annotations).toHaveLength(6);
      expect(published.userKey).toBeUndefined();
      expect(ctx.ack).toHaveBeenCalled();
    });
  });
});
