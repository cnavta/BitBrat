import { createTextCandidate, appendTextCandidate } from '../../../src/services/command-processor/candidate';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!ping' },
  } as any;
}

describe('candidate helpers', () => {
  it('createTextCandidate builds a valid candidate', () => {
    const c = createTextCandidate('hello', { k: 1 });
    expect(c.id).toBeDefined();
    expect(c.kind).toBe('text');
    expect(c.source).toBe('command-processor');
    expect(c.status).toBe('proposed');
    expect(c.priority).toBe(100);
    expect(c.text).toBe('hello');
    expect(c.format).toBe('plain');
    expect(c.metadata).toEqual({ k: 1 });
  });

  it('appendTextCandidate appends to event.candidates and returns the candidate', () => {
    const evt = makeEvent();
    const c = appendTextCandidate(evt, 'hi');
    expect(evt.candidates).toBeDefined();
    expect(Array.isArray(evt.candidates)).toBe(true);
    expect(evt.candidates!.length).toBe(1);
    expect(evt.candidates![0].id).toBe(c.id);
    expect(evt.candidates![0].text).toBe('hi');
  });
});
