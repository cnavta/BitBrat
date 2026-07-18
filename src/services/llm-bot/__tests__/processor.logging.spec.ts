import { processEvent } from '../processor';
import { Bit } from '../../../common/base-server';
import { InternalEventV2 } from '../../../types/events';
import { getFirestore } from '../../../common/firebase';
import { isFeatureEnabled } from '../../../common/feature-flags';

jest.mock('../../../common/firebase');
jest.mock('../../../common/feature-flags');

class TestServer extends Bit {
  private mockDocumentStore: any;

  constructor(documentStore?: any) {
    super({ serviceName: 'test-llm-bot' });
    this.mockDocumentStore = documentStore;
  }

  getConfig(name?: string, options?: any): any {
    if (name === 'OPENAI_MODEL') return 'gpt-4o';
    if (name === 'LLM_PLATFORM') return 'openai';
    return options?.default;
  }

  // Sprint 344: Override getResource to provide documentStore for prompt logging
  protected getResource<T>(name: string): T | undefined {
    if (name === 'documentStore' && this.mockDocumentStore) {
      return this.mockDocumentStore as T;
    }
    return super.getResource(name);
  }
}

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'corr-log-test',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    annotations: [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ]
  } as any;
}

describe('llm-bot processor logging', () => {
  let mockSet: jest.Mock;
  let mockDocumentStore: any;

  beforeEach(() => {
    jest.resetAllMocks();

    // Sprint 344: Mock documentStore (PostgreSQL) instead of Firestore
    mockSet = jest.fn().mockResolvedValue(undefined);
    mockDocumentStore = {
      set: mockSet,
      get: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
    };

    (isFeatureEnabled as jest.Mock).mockImplementation((key) => {
      if (key === 'llm.promptLogging.enabled') return true;
      return false;
    });
  });

  test('records processingTimeMs in PostgreSQL prompt_logs', async () => {
    const server = new TestServer(mockDocumentStore);
    const evt = baseEvt();

    const status = await processEvent(server, evt, {
      callLLM: async () => {
        // simulate some work
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'Hi there!';
      }
    } as any);

    expect(status).toBe('OK');
    expect(mockSet).toHaveBeenCalled();

    // Check the data passed to documentStore.set(table, id, data)
    const [tableName, _id, logData] = mockSet.mock.calls[0];
    expect(tableName).toBe('prompt_logs');
    expect(logData).toBeDefined();
    expect(logData.processingTimeMs).toBeGreaterThanOrEqual(40);
    expect(logData.correlationId).toBe('corr-log-test');
    expect(logData.platform).toBe('openai');
    expect(logData.model).toBe('gpt-4o');
    expect(logData.behaviorProfile).toMatchObject({
      intent: 'question',
      responseMode: 'answer',
      risk: { level: 'none', type: 'none' },
    });
  });
});
