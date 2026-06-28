// Unit tests for the Context Pack convention (sprint-328, BL-328-100/-101/-200).
import {
  StaticContextProvider,
  resolveContextPacks,
  bindingMatches,
  packToNamedContext,
  packsToNamedContexts,
  formatPackSubheader,
  parsePackSubheader,
  extractContextPacksFromNamedContexts,
  type ContextPack,
  type ContextBinding,
  type ContextProvider,
} from '../../../src/common/context';
import type { NamedContext } from '../../../src/common/prompt-assembly/types';

const schemaPack: ContextPack = {
  id: 'schema.internal-event-v2',
  version: '2',
  title: 'Event Schema v2',
  priority: 2,
  format: 'markdown',
  body: '# schema body',
  source: 'src/types/events.ts',
};

const routerPack: ContextPack = {
  id: 'router.jsonlogic-guide',
  version: '1',
  title: 'JsonLogic Guide',
  format: 'markdown',
  body: '# router body',
  source: 'src/services/router/jsonlogic-evaluator.ts',
};

const jsonPack: ContextPack = {
  id: 'demo.json',
  version: '1',
  title: 'Demo JSON',
  format: 'json',
  body: { a: 1 },
  source: 'test',
};

describe('ContextPack type construction', () => {
  it('builds a well-formed pack with all required fields', () => {
    expect(schemaPack).toMatchObject({ id: expect.any(String), version: expect.any(String), title: expect.any(String), format: 'markdown', source: expect.any(String) });
    expect(typeof schemaPack.body).toBe('string');
  });
});

describe('bindingMatches', () => {
  const binding: ContextBinding = { pack: 'schema.internal-event-v2', when: { tools: ['create_schedule'], tasks: ['enrichment'], eventTypes: ['llm.request.v1'] } };
  it('matches by tool', () => expect(bindingMatches(binding, { tools: ['create_schedule'] })).toBe(true));
  it('matches by task', () => expect(bindingMatches(binding, { tasks: ['enrichment'] })).toBe(true));
  it('matches by eventType', () => expect(bindingMatches(binding, { eventTypes: ['llm.request.v1'] })).toBe(true));
  it('does not match an unrelated active set', () => expect(bindingMatches(binding, { tools: ['other_tool'] })).toBe(false));
});

describe('resolveContextPacks', () => {
  const provider: ContextProvider = new StaticContextProvider(
    [schemaPack, routerPack],
    [
      { pack: 'schema.internal-event-v2', when: { tools: ['create_schedule'] } },
      { pack: 'router.jsonlogic-guide', when: { tools: ['create_rule'] } },
      { pack: 'schema.internal-event-v2', when: { tools: ['create_rule'] } },
    ],
  );

  it('match-by-tool resolves the bound pack', () => {
    const packs = resolveContextPacks({ tools: ['create_schedule'] }, [provider]);
    expect(packs.map((p) => p.id)).toEqual(['schema.internal-event-v2']);
  });

  it('match-by-task resolves task-bound packs', () => {
    const taskProvider = new StaticContextProvider([schemaPack], [{ pack: 'schema.internal-event-v2', when: { tasks: ['enrichment'] } }]);
    const packs = resolveContextPacks({ tasks: ['enrichment'] }, [taskProvider]);
    expect(packs.map((p) => p.id)).toEqual(['schema.internal-event-v2']);
  });

  it('match-by-eventType resolves eventType-bound packs', () => {
    const evProvider = new StaticContextProvider([schemaPack], [{ pack: 'schema.internal-event-v2', when: { eventTypes: ['llm.request.v1'] } }]);
    const packs = resolveContextPacks({ eventTypes: ['llm.request.v1'] }, [evProvider]);
    expect(packs.map((p) => p.id)).toEqual(['schema.internal-event-v2']);
  });

  it('de-dupes a shared pack matched via multiple tools', () => {
    const packs = resolveContextPacks({ tools: ['create_schedule', 'create_rule'] }, [provider]);
    const ids = packs.map((p) => p.id);
    expect(ids.filter((id) => id === 'schema.internal-event-v2')).toHaveLength(1);
    expect(ids).toContain('router.jsonlogic-guide');
  });

  it('surfaces unknown pack ids as a warning, not a throw', () => {
    const warn = jest.fn();
    const badProvider = new StaticContextProvider([], [{ pack: 'does.not.exist', when: { tools: ['x'] } }]);
    const packs = resolveContextPacks({ tools: ['x'] }, [badProvider], { onWarn: warn });
    expect(packs).toEqual([]);
    expect(warn).toHaveBeenCalledWith('context.resolve.unknown_pack', { pack: 'does.not.exist' });
  });

  it('returns [] for an empty active set (no-op)', () => {
    expect(resolveContextPacks({}, [provider])).toEqual([]);
    expect(resolveContextPacks({ tools: [] }, [provider])).toEqual([]);
  });
});

describe('packToNamedContext mapping', () => {
  it('preserves priority + title and passes markdown body through as a string', () => {
    const nc = packToNamedContext(schemaPack);
    expect(nc.name).toBe('Event Schema v2');
    expect(nc.priority).toBe(2);
    expect(typeof nc.content).toBe('string');
    expect(nc.subheader).toContain('schema.internal-event-v2 v2');
  });

  it('defaults priority to 3 when unset', () => {
    expect(packToNamedContext(routerPack).priority).toBe(3);
  });

  it('passes a json body through as an object', () => {
    const nc = packToNamedContext(jsonPack);
    expect(typeof nc.content).toBe('object');
    expect(nc.content).toEqual({ a: 1 });
  });

  it('maps an ordered list preserving order', () => {
    const ncs = packsToNamedContexts([schemaPack, routerPack]);
    expect(ncs.map((n) => n.name)).toEqual(['Event Schema v2', 'JsonLogic Guide']);
  });
});

describe('pack subheader format/parse (round-trip)', () => {
  it('formats then parses back to the same identity', () => {
    const sub = formatPackSubheader(schemaPack);
    expect(sub).toBe('schema.internal-event-v2 v2 (source: src/types/events.ts)');
    expect(parsePackSubheader(sub)).toEqual({
      id: 'schema.internal-event-v2',
      version: '2',
      source: 'src/types/events.ts',
    });
  });

  it('round-trips the subheader produced by packToNamedContext', () => {
    const nc = packToNamedContext(routerPack);
    expect(parsePackSubheader(nc.subheader)).toEqual({
      id: 'router.jsonlogic-guide',
      version: '1',
      source: 'src/services/router/jsonlogic-evaluator.ts',
    });
  });

  it('returns null for missing or non-pack subheaders', () => {
    expect(parsePackSubheader(undefined)).toBeNull();
    expect(parsePackSubheader('')).toBeNull();
    expect(parsePackSubheader('Some free-form descriptive text')).toBeNull();
  });
});

describe('extractContextPacksFromNamedContexts', () => {
  it('returns refs only for pack-originated contexts, preserving order', () => {
    const contexts: NamedContext[] = [
      packToNamedContext(schemaPack),
      { name: 'World State', content: 'a non-pack adventure context', priority: 3 },
      packToNamedContext(routerPack),
    ];
    const refs = extractContextPacksFromNamedContexts(contexts);
    expect(refs).toEqual([
      { id: 'schema.internal-event-v2', version: '2', title: 'Event Schema v2', source: 'src/types/events.ts' },
      { id: 'router.jsonlogic-guide', version: '1', title: 'JsonLogic Guide', source: 'src/services/router/jsonlogic-evaluator.ts' },
    ]);
  });

  it('returns [] when there are no contexts or none are packs', () => {
    expect(extractContextPacksFromNamedContexts(undefined)).toEqual([]);
    expect(extractContextPacksFromNamedContexts([])).toEqual([]);
    expect(extractContextPacksFromNamedContexts([{ name: 'X', content: 'y' }])).toEqual([]);
  });
});
