import { StreamAnalystEngine } from './engine';
import { generateText } from 'ai';

jest.mock('ai', () => ({
  generateText: jest.fn().mockResolvedValue({ text: 'Mocked summary' })
}));

describe('StreamAnalystEngine', () => {
  let engine: StreamAnalystEngine;
  let mockFirestore: any;
  let mockLogger: any;

  beforeEach(() => {
    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [
          { data: () => ({ ingress: { ingressAt: '2026-04-25T14:00:00Z' }, identity: { external: { displayName: 'U1' } }, message: { text: 'Msg 1' } }) },
          { data: () => ({ ingress: { ingressAt: '2026-04-25T14:00:01Z' }, identity: { external: { displayName: 'U2' } }, message: { text: 'Msg 2' } }) }
        ]
      })
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    engine = new StreamAnalystEngine(mockFirestore as any, mockLogger);
    
    // Clear mock calls
    (generateText as jest.Mock).mockClear();
  });

  it('should summarize events successfully', async () => {
    const result = await engine.summarize({
      streamType: 'chat',
      windowMinutes: 10,
      requestId: 'req-1'
    });

    expect(result).toBe('Mocked summary');
    expect(mockFirestore.collection).toHaveBeenCalledWith('events');
    // It should have been called with eventType == chat.message.v1
    expect(mockFirestore.where).toHaveBeenCalledWith('eventType', '==', 'chat.message.v1');
    expect(generateText).toHaveBeenCalled();
  });

  it('should handle no events found', async () => {
    mockFirestore.get.mockResolvedValue({ docs: [] });
    const result = await engine.summarize({
      streamType: 'chat',
      windowMinutes: 10,
      requestId: 'req-2'
    });

    expect(result).toContain('No events found');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('should pass context to LLM in chronological order', async () => {
    mockFirestore.get.mockResolvedValue({
      docs: [
        { data: () => ({ ingress: { ingressAt: '2026-04-25T14:00:01Z' }, identity: { external: { displayName: 'U2' } }, message: { text: 'Newer' } }) },
        { data: () => ({ ingress: { ingressAt: '2026-04-25T14:00:00Z' }, identity: { external: { displayName: 'U1' } }, message: { text: 'Older' } }) }
      ]
    });

    await engine.summarize({
      streamType: 'chat',
      windowMinutes: 10,
      requestId: 'req-3'
    });

    const call = (generateText as jest.Mock).mock.calls[0][0];
    const prompt = call.prompt;
    
    const olderIndex = prompt.indexOf('Older');
    const newerIndex = prompt.indexOf('Newer');
    
    expect(olderIndex).toBeLessThan(newerIndex);
  });

  it('should support inspection and return structured JSON', async () => {
    const mockedJson = JSON.stringify({
      summary: 'Structured summary',
      annotations: [
        { kind: 'sentiment', label: 'positive', score: 0.9 }
      ]
    });
    (generateText as jest.Mock).mockResolvedValue({ text: `\`\`\`json\n${mockedJson}\n\`\`\`` });

    const result = await engine.summarize({
      streamType: 'chat',
      windowMinutes: 10,
      requestId: 'req-4',
      inspectionEnabled: true
    });

    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe('Structured summary');
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations[0].kind).toBe('sentiment');
    expect(parsed.annotations[0].id).toBeDefined();
  });
});
