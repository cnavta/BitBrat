import { extractEgressTextFromEvent } from '../src/common/events/selection';
import { InternalEventV2 } from '../src/types/events';

describe('Egress Selection - Redelivery Reproduction', () => {
  it('should NOT redeliver original message text if no candidates are present', () => {
    const event: InternalEventV2 = {
      v: '1',
      type: 'chat.message',
      source: 'api-gateway',
      correlationId: 'test-corr',
      userId: 'test-user',
      egress: { destination: 'api-gateway', type: 'chat' },
      message: {
        id: 'msg-1',
        role: 'user',
        text: 'Hello Platform!',
        rawPlatformPayload: {
          text: 'Hello Platform!'
        }
      },
      payload: {
        text: 'Hello Platform!'
      },
      candidates: [] // Empty candidates
    };

    const egressText = extractEgressTextFromEvent(event);
    
    // The issue is that it CURRENTLY returns 'Hello Platform!'
    // We want it to return null or undefined if no bot candidate is selected.
    expect(egressText).toBeNull();
  });

  it('should deliver candidate text when present', () => {
    const event: InternalEventV2 = {
      v: '1',
      type: 'chat.message',
      source: 'api-gateway',
      correlationId: 'test-corr',
      userId: 'test-user',
      egress: { destination: 'api-gateway', type: 'chat' },
      message: {
        id: 'msg-1',
        role: 'user',
        text: 'Hello Platform!',
        rawPlatformPayload: {
          text: 'Hello Platform!'
        }
      },
      candidates: [
        {
          id: 'cand-1',
          kind: 'text',
          source: 'llm-bot',
          createdAt: new Date().toISOString(),
          status: 'proposed',
          priority: 10,
          text: 'Hello User!'
        }
      ]
    };

    const egressText = extractEgressTextFromEvent(event);
    expect(egressText).toBe('Hello User!');
  });
});
