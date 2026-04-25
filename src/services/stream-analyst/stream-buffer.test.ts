import { StreamBuffer } from './stream-buffer';
import type { InternalEventV2 } from '../../types/events';

describe('StreamBuffer', () => {
  let buffer: StreamBuffer;

  beforeEach(() => {
    buffer = new StreamBuffer(100); // Small limit for testing
  });

  it('should normalize and add events', () => {
    const event: InternalEventV2 = {
      v: '2',
      correlationId: 'abc',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2026-04-25T14:00:00Z', source: 'test', connector: 'system' },
      identity: { external: { id: 'user1', platform: 'twitch', displayName: 'UserOne' } },
      message: { id: 'm1', role: 'user', text: 'Hello world' },
      routing: { stage: 'initial', slip: [], history: [] }
    } as any;

    const added = buffer.addEvent(event);
    expect(added).toBe(true);
    expect(buffer.getContent()).toContain('[2026-04-25T14:00:00Z] [UserOne] Hello world');
  });

  it('should redact emails and tokens', () => {
    const event: InternalEventV2 = {
      v: '2',
      correlationId: 'abc',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2026-04-25T14:00:00Z', source: 'test', connector: 'system' },
      identity: { external: { id: 'user1', platform: 'twitch', displayName: 'UserOne' } },
      message: { id: 'm1', role: 'user', text: 'My email is test@example.com and my token is abcdef1234567890abcdef1234567890' },
      routing: { stage: 'initial', slip: [], history: [] }
    } as any;

    buffer.addEvent(event);
    const content = buffer.getContent();
    expect(content).toContain('[REDACTED_EMAIL]');
    expect(content).toContain('[REDACTED_TOKEN]');
    expect(content).not.toContain('test@example.com');
    expect(content).not.toContain('abcdef1234567890abcdef1234567890');
  });

  it('should honor token limits', () => {
    buffer = new StreamBuffer(50); // Very small limit
    
    const event: InternalEventV2 = {
      v: '2',
      correlationId: 'abc',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2026-04-25T14:00:00Z', source: 'test', connector: 'system' },
      identity: { external: { id: 'user1', platform: 'twitch', displayName: 'UserOne' } },
      message: { id: 'm1', role: 'user', text: 'This is a long message that should take up some tokens.' },
      routing: { stage: 'initial', slip: [], history: [] }
    } as any;

    const added1 = buffer.addEvent(event);
    expect(added1).toBe(true);

    const added2 = buffer.addEvent(event); // Should fail to add second message
    expect(added2).toBe(false);
    
    expect(buffer.getTokens()).toBeLessThanOrEqual(50);
  });

  it('should return content in chronological order if added in reverse', () => {
    const e1: any = { ingress: { ingressAt: '2026-04-25T14:00:01Z' }, identity: { external: { displayName: 'U1' } }, message: { text: 'Second' } };
    const e2: any = { ingress: { ingressAt: '2026-04-25T14:00:00Z' }, identity: { external: { displayName: 'U1' } }, message: { text: 'First' } };

    buffer.addEvent(e1); // Added "newer" first (DESC order from Firestore)
    buffer.addEvent(e2);

    const content = buffer.getContent();
    const lines = content.split('\n');
    expect(lines[0]).toContain('First');
    expect(lines[1]).toContain('Second');
  });
});
