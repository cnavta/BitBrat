import { parseCommandFromText, processForParsing } from '../../../src/services/command-processor/processor';
import type { InternalEventV2 } from '../../../src/types/events';

function makeEvent(text: string): InternalEventV2 {
  return {
    v: '1',
    source: 'test',
    correlationId: 'c-parse-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text },
  } as any;
}

describe('command parsing', () => {
  it('parseCommandFromText lowercases name and splits args', () => {
    const parsed = parseCommandFromText('!ShOuT Alice   Bob', '!');
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('shout');
    expect(parsed!.args).toEqual(['Alice', 'Bob']);
  });

  it('processForParsing no longer requires a sigil (regex path may apply)', () => {
    const evt = makeEvent('hello world');
    const res = processForParsing(evt);
    // Under vNext, absence of a sigil does not end the pipeline; regex path can still match.
    expect(res.action).toBe('parsed');
    expect(res.stepStatus).toBe('OK');
    expect(res.parsed).toBeUndefined();
  });

  it('processForParsing returns parsed for sigil messages', () => {
    const evt = makeEvent('!ping arg1 arg2');
    const res = processForParsing(evt);
    expect(res.action).toBe('parsed');
    expect(res.parsed).toBeDefined();
    expect(res.parsed!.name).toBe('ping');
    expect(res.parsed!.args).toEqual(['arg1', 'arg2']);
  });
});
