import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-1',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'what do I see?' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
    identity: { user: { id: 'u1' } }
  } as any;
}

describe('llm-bot processor – story engine integration', () => {
  test('maps adventure_context annotation to structured NamedContexts', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    
    // Add adventure routing slip to trigger narrator prompt injection if needed (though we mostly care about context mapping here)
    evt.routing = { slip: [{ id: 'adventure' }] } as any;

    const adventureData = {
      storyId: 'story-123',
      theme: 'cyberpunk',
      setting: 'Neo-Tokyo',
      currentScene: 'You are in a dark alley.',
      availableChoices: ['Look around', 'Run away'],
      worldStateSummary: { reputation: 10, credits: 500 }
    };

    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'You are a helpful narrator.' },
      { 
        id: 'a2', 
        kind: 'instruction', 
        label: 'adventure_context', 
        source: 'story-engine-mcp', 
        createdAt: new Date().toISOString(), 
        value: JSON.stringify(adventureData) 
      },
    ] as any;

    let capturedPrompt = '';
    await processEvent(server, evt, {
      callLLM: async (_model, input) => {
        capturedPrompt = input;
        return 'The alley is damp.';
      }
    });

    // Check canonical order and section presence
    expect(capturedPrompt).toContain('## [Contexts]');
    expect(capturedPrompt).toContain('## Adventure Meta');
    expect(capturedPrompt).toContain('"storyId": "story-123"');
    expect(capturedPrompt).toContain('"theme": "cyberpunk"');
    expect(capturedPrompt).toContain('## Current Scene');
    expect(capturedPrompt).toContain('You are in a dark alley.');
    expect(capturedPrompt).toContain('## Available Choices');
    expect(capturedPrompt).toContain('Look around');
    expect(capturedPrompt).toContain('## World State');
    expect(capturedPrompt).toContain('"reputation": 10');

    // Ensure it's NOT in the Task section or just raw text at the bottom
    const taskIdx = capturedPrompt.indexOf('## [Task]');
    const contextsIdx = capturedPrompt.indexOf('## [Contexts]');
    expect(contextsIdx).toBeLessThan(taskIdx);
    
    // Verify it replaced generic extraction
    // (generic extraction would have put the JSON in Task section if it wasn't filtered)
    const taskSection = capturedPrompt.split('## [Task]')[1].split('## [')[0];
    expect(taskSection).not.toContain('adventure_context');
    expect(taskSection).not.toContain('story-123');
  });
});
