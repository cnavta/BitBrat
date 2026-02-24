import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import { InternalEventV2 } from '../../../types/events';
import { getFirestore } from '../../../common/firebase';
import { isFeatureEnabled } from '../../../common/feature-flags';

jest.mock('../../../common/firebase');
jest.mock('../../../common/feature-flags');

class TestServer extends BaseServer {
  constructor() {
    super({ serviceName: 'test-llm-bot' });
  }
  getConfig(name?: string, options?: any): any {
    if (name === 'OPENAI_MODEL') return 'gpt-4o';
    if (name === 'LLM_PLATFORM') return 'openai';
    return options?.default;
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
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;
  let mockDoc: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockAdd = jest.fn().mockResolvedValue({ id: 'new-log-id' });
    mockCollection = jest.fn().mockReturnThis();
    mockDoc = jest.fn().mockReturnThis();

    (getFirestore as jest.Mock).mockReturnValue({
      collection: mockCollection,
      doc: mockDoc,
      add: mockAdd,
    });

    (isFeatureEnabled as jest.Mock).mockImplementation((key) => {
      if (key === 'llm.promptLogging.enabled') return true;
      return false;
    });
  });

  test('records processingTimeMs in Firestore prompt_logs', async () => {
    const server = new TestServer();
    const evt = baseEvt();

    const status = await processEvent(server, evt, {
      callLLM: async () => {
        // simulate some work
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'Hi there!';
      }
    } as any);

    expect(status).toBe('OK');
    expect(mockCollection).toHaveBeenCalledWith('prompt_logs');
    
    // Check the data passed to .add()
    const logData = mockAdd.mock.calls[0][0];
    expect(logData).toBeDefined();
    expect(logData.processingTimeMs).toBeGreaterThanOrEqual(40);
    expect(logData.correlationId).toBe('corr-log-test');
    expect(logData.platform).toBe('openai');
    expect(logData.model).toBe('gpt-4o');
  });
});
