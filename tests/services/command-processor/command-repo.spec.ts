import { findByNameOrAlias } from '../../../src/services/command-processor/command-repo';

function makeSnapshot(docData: any | null) {
  if (!docData) return { empty: true, docs: [] } as any;
  return {
    empty: false,
    docs: [
      {
        id: 'doc-1',
        data: () => docData,
        ref: {} as any,
      },
    ],
  } as any;
}

function makeDb(options: { nameDoc?: any | null; aliasDoc?: any | null }) {
  const nameSnap = makeSnapshot(options.nameDoc ?? null);
  const aliasSnap = makeSnapshot(options.aliasDoc ?? null);
  return {
    collection: (_path: string) => ({
      where: (field: string, _op: string, _val: any) => ({
        limit: (_n: number) => ({
          get: async () => (field === 'name' ? nameSnap : aliasSnap),
        }),
      }),
    }),
  } as any;
}

describe('command-repo.findByNameOrAlias', () => {
  it('returns command by canonical name', async () => {
    const db = makeDb({
      nameDoc: { name: 'so', templates: [{ id: 't1', text: 'Hello' }] },
      aliasDoc: null,
    });
    const res = await findByNameOrAlias('so', db);
    expect(res).not.toBeNull();
    expect(res!.doc.name).toBe('so');
    expect(res!.doc.templates.length).toBe(1);
  });

  it('falls back to alias lookup when name not found', async () => {
    const db = makeDb({
      nameDoc: null,
      aliasDoc: { name: 'shoutout', aliases: ['so'], templates: [{ id: 't2', text: 'Hi' }] },
    });
    const res = await findByNameOrAlias('so', db);
    expect(res).not.toBeNull();
    expect(res!.doc.name).toBe('shoutout');
    expect(res!.doc.templates[0].id).toBe('t2');
  });

  it('returns null when neither name nor alias matches', async () => {
    const db = makeDb({ nameDoc: null, aliasDoc: null });
    const res = await findByNameOrAlias('missing', db);
    expect(res).toBeNull();
  });

  it('normalizes vNext fields: provides default matchType when absent', async () => {
    const db = makeDb({
      nameDoc: { name: 'alpha', /* legacy fields ignored */ templates: [{ id: 't1', text: 'x' }] },
      aliasDoc: null,
    });
    const res = await findByNameOrAlias('alpha', db);
    expect(res).not.toBeNull();
    expect(res!.doc.matchType.kind).toBe('command');
    expect(res!.doc.matchType.values).toContain('alpha');
    expect(typeof res!.doc.matchType.priority).toBe('number');
  });
});
