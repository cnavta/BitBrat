import { buildRenderContext, renderTemplate } from '../../../src/services/command-processor/templates';
import type { InternalEventV2 } from '../../../src/types/events';

describe('templates.renderTemplate', () => {
  function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
    return {
      v: '1',
      source: 'test',
      correlationId: 'c-1',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hi' },
      ...overrides,
    } as any;
  }

  it('renders botName, username, and utcNow placeholders', () => {
    const evt = makeEvent({ user: { id: 'u1', displayName: 'Alice' } as any });
    const ctx = buildRenderContext(evt);
    const out = renderTemplate('Hi {{username}}, I am {{botName}} at {{utcNow}}', ctx);
    expect(out).toContain('Alice');
    expect(out).toContain(String(ctx.botName));
    expect(out).toContain(String(ctx.utcNow));
  });

  it('leaves unknown placeholders intact', () => {
    const evt = makeEvent();
    const ctx = buildRenderContext(evt);
    const out = renderTemplate('X {{unknown}} Y', ctx);
    expect(out).toBe('X {{unknown}} Y');
  });

  it('returns empty string for non-string inputs', () => {
    const evt = makeEvent();
    const ctx = buildRenderContext(evt);
    // @ts-expect-error test non-string
    expect(renderTemplate(null, ctx)).toBe('');
  });
});
