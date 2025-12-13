import { applyMemoryReducer, type ChatMessage } from './processor';

describe('applyMemoryReducer', () => {
  function msg(role: 'system'|'user'|'assistant', content: string): ChatMessage {
    return { role, content, createdAt: new Date().toISOString() };
  }

  test('appends incoming to existing without trimming when under limits', () => {
    const existing = [msg('user', 'hello')];
    const incoming = [msg('assistant', 'hi there')];
    const { messages, trimmedByChars, trimmedByCount } = applyMemoryReducer(existing, incoming, { maxMessages: 10, maxChars: 1000 });
    expect(messages.map(m => m.content)).toEqual(['hello', 'hi there']);
    expect(trimmedByChars).toBe(0);
    expect(trimmedByCount).toBe(0);
  });

  test('trims by chars by dropping oldest first until under limit', () => {
    const long = 'X'.repeat(50);
    const existing = [msg('user', long)];
    const incoming = [msg('user', 'short')];
    const { messages, trimmedByChars, trimmedByCount } = applyMemoryReducer(existing, incoming, { maxMessages: 10, maxChars: 10 });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('short');
    expect(trimmedByChars).toBe(long.length);
    expect(trimmedByCount).toBe(0);
  });

  test('trims by count keeping the last N messages', () => {
    const existing = [msg('user', 'one'), msg('assistant', 'two')];
    const incoming = [msg('user', 'three')];
    const { messages, trimmedByChars, trimmedByCount } = applyMemoryReducer(existing, incoming, { maxMessages: 2, maxChars: 1000 });
    expect(messages.map(m => m.content)).toEqual(['two', 'three']);
    expect(trimmedByChars).toBeGreaterThanOrEqual(0); // may be 0; count trimming is tracked separately
    expect(trimmedByCount).toBe(1);
  });

  test('keeps leading system message and trims history by count', () => {
    const existing = [msg('system', 'SYS'), msg('user', 'one'), msg('assistant', 'two')];
    const incoming = [msg('user', 'three'), msg('assistant', 'four')];
    const { messages, trimmedByChars, trimmedByCount } = applyMemoryReducer(existing, incoming, { maxMessages: 3, maxChars: 1000 });
    // Expect system pinned + last 2 history turns
    expect(messages.map(m => `(${m.role}) ${m.content}`)).toEqual(['(system) SYS', '(user) three', '(assistant) four']);
    expect(trimmedByChars).toBe(0);
    expect(trimmedByCount).toBe(2); // dropped 'one' and 'two'
  });

  test('keeps leading system message and trims history by chars', () => {
    const sys = 'S'.repeat(50);
    const a = 'A'.repeat(60);
    const b = 'B'.repeat(60);
    const existing = [msg('system', sys), msg('user', a)];
    const incoming = [msg('user', b)];
    const { messages, trimmedByChars, trimmedByCount } = applyMemoryReducer(existing, incoming, { maxMessages: 10, maxChars: 70 });
    // Only system should remain due to tight char limit
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(sys);
    expect(trimmedByChars).toBe(a.length + b.length);
    expect(trimmedByCount).toBe(0);
  });
});
