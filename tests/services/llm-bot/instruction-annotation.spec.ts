import { processEvent } from '../../../src/services/llm-bot/processor';
import { BaseServer } from '../../../src/common/base-server';
import { InternalEventV2 } from '../../../src/types/events';
import { resolvePersonalityParts } from '../../../src/services/llm-bot/personality-resolver';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
  openai: jest.fn(),
}));

jest.mock('../../../src/services/llm-bot/instance-memory');
jest.mock('../../../src/services/llm-bot/personality-resolver');
jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));
jest.mock('../../../src/common/feature-flags', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(false),
}));

describe('Instruction Annotation', () => {
  let mockServer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (resolvePersonalityParts as jest.Mock).mockResolvedValue([]);
    mockServer = {
      getConfig: jest.fn((key, { default: def } = {}) => def),
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };
  });

  it('should include "instruction" kind annotations in the prompt', async () => {
    const evt: InternalEventV2 = {
      correlationId: 'corr-instruction',
      type: 'internal.llmbot.v1' as any,
      v: '2',
      ingress: {
        connector: 'system',
        ingressAt: new Date().toISOString(),
        source: 'test',
        channel: 'test',
      },
      identity: {
        external: { id: 'u1', platform: 'test' }
      },
      annotations: [
        { 
          id: 'a1', 
          kind: 'instruction' as any, 
          value: 'This is a special instruction.', 
          createdAt: new Date().toISOString(), 
          source: 'test' 
        }
      ],
      routing: { stage: 'analysis', slip: [], history: [] },
      egress: { connector: 'system', destination: 'test' },
    };

    const callLLM = jest.fn().mockResolvedValue('Mocked response');

    // We pass callLLM in deps to capture the full prompt string
    const result = await processEvent(mockServer as BaseServer, evt, { callLLM });

    if (result === 'ERROR') {
      console.error('Errors:', JSON.stringify(evt.errors, null, 2));
    }

    expect(result).toBe('OK');
    expect(callLLM).toHaveBeenCalled();
    const fullPrompt = callLLM.mock.calls[0][1];
    
    // This is expected to FAIL before the fix
    expect(fullPrompt).toContain('This is a special instruction.');
  });
});
