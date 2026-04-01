import { z } from 'zod';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(() => undefined),
}));

jest.mock('../../common/llm/provider-factory', () => ({
  getLlmProvider: jest.fn(() => 'mock-provider'),
}));

import { generateText } from 'ai';
import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-tools',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    identity: {
      external: { id: 'user-1', platform: 'test', roles: [] },
    },
    ingress: { ingressAt: new Date().toISOString(), source: 'test' },
    egress: { destination: 'internal.egress.v1' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot behavioral tool filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (generateText as jest.Mock).mockResolvedValue({ text: 'done', steps: [], toolCalls: [], toolResults: [] });
  });

  test('allows only internal status tools for meta intent', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'answer' },
      { id: 'a2', kind: 'intent', source: 'test', createdAt: new Date().toISOString(), value: 'meta' },
      { id: 'a3', kind: 'risk', source: 'test', createdAt: new Date().toISOString(), label: 'low', payload: { level: 'low', type: 'none' } },
    ] as any;

    const registry = {
      getTools: () => ({
        status: {
          id: 'internal:get_bot_status',
          source: 'internal',
          description: 'status',
          inputSchema: z.object({}),
          execute: jest.fn(),
        },
        weather: {
          id: 'mcp:weather_lookup',
          source: 'mcp',
          description: 'weather',
          inputSchema: z.object({ city: z.string() }),
          execute: jest.fn(),
        },
      }),
    } as any;

    const status = await processEvent(server, evt, { registry });

    expect(status).toBe('OK');
    const generateTextArgs = (generateText as jest.Mock).mock.calls[0][0];
    expect(Object.keys(generateTextArgs.tools)).toEqual(['status']);
    const strategyAnnotation = evt.annotations?.find((annotation: any) => annotation.kind === 'response-strategy');
    expect(strategyAnnotation?.payload?.toolUse?.suppressed).toEqual(
      expect.arrayContaining([{ tool: 'mcp:weather_lookup', reason: 'meta intent only allows internal status tools' }])
    );
  });
});