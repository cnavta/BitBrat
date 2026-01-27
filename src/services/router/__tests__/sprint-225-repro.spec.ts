import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV2 } from '../../../types/events';
import type { IConfig } from '../../../types';

describe('Sprint 225: JsonLogic !lurk matching reproduction', () => {
  const config: any = {
    port: 8080,
    logLevel: 'info',
    commandSigil: '!',
    twitchScopes: [],
    twitchChannels: [],
  };

  const lurkRule = {
    "text_contains": [
      { "var": "message.text" },
      { "cat": [ { "var": "config.commandSigil" }, "lurk " ] },
      true
    ]
  };

  it('matches "!lurk" even when rule has a trailing space (Sprint 225 fix)', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'test',
      correlationId: 'abc',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: '!lurk' },
    } as any;

    const ctx = buildContext(evt, undefined, undefined, config);
    
    // This should now PASS
    const result = evaluate(lurkRule, ctx);
    expect(result).toBe(true); 
  });

  it('matches "!lurk " (with space) when rule has a trailing space in "lurk "', () => {
    const evt: InternalEventV2 = {
      v: '1',
      source: 'test',
      correlationId: 'abc',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: '!lurk ' },
    } as any;

    const ctx = buildContext(evt, undefined, undefined, config);
    
    const result = evaluate(lurkRule, ctx);
    expect(result).toBe(true);
  });

  it('matches "!LURK" when rule is updated to NOT have a trailing space', () => {
    const fixedLurkRule = {
      "text_contains": [
        { "var": "message.text" },
        { "cat": [ { "var": "config.commandSigil" }, "lurk" ] },
        true
      ]
    };
    const evt: InternalEventV2 = {
      v: '1',
      source: 'test',
      correlationId: 'abc',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: '!LURK' },
    } as any;

    const ctx = buildContext(evt, undefined, undefined, config);
    
    const result = evaluate(fixedLurkRule, ctx);
    expect(result).toBe(true);
  });
});
