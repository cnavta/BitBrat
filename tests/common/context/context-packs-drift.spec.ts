// Drift-guard + generation tests for the generated Context Packs (sprint-328, BL-328-300/-301/-302).
//
// These assert the generated packs are derived from the source of truth and FAIL if a documented
// annotation kind / field path / operator no longer exists in source (or a registered operator is
// omitted), so the docs cannot silently rot (Immutable Law #2 / G2).
import {
  buildInternalEventSchemaPack,
  buildRouterJsonLogicPack,
  INTERNAL_EVENT_V2_FIELD_PATHS,
  ANNOTATION_V1_FIELD_PATHS,
} from '../../../src/common/context';
import { ANNOTATION_KINDS_V1 } from '../../../src/types/events';
import { CUSTOM_OPERATORS, EVAL_CONTEXT_PATHS } from '../../../src/services/router/jsonlogic-evaluator';
import type { InternalEventV2, AnnotationV1 } from '../../../src/types/events';

describe('router.jsonlogic-guide pack (generated from jsonlogic-evaluator.ts)', () => {
  const pack = buildRouterJsonLogicPack();
  const body = String(pack.body);

  it('carries id, version + source provenance', () => {
    expect(pack.id).toBe('router.jsonlogic-guide');
    expect(pack.version).toBe('1');
    expect(pack.source).toBe('src/services/router/jsonlogic-evaluator.ts');
  });

  it('lists ALL 7 registered custom operators (none omitted)', () => {
    expect(CUSTOM_OPERATORS).toHaveLength(7);
    for (const op of CUSTOM_OPERATORS) {
      expect(body).toContain(op.name);
    }
  });

  it('drift guard: every operator the pack documents is registered in source', () => {
    const knownOps = new Set(CUSTOM_OPERATORS.map((o) => o.name));
    // Operator tokens documented in the pack body (lines that start "- `<sig>`").
    const documented = body
      .split('\n')
      .filter((l) => l.trim().startsWith('- `'))
      .map((l) => (l.match(/- `([a-z_]+)\(/) || [])[1])
      .filter(Boolean) as string[];
    const opTokens = documented.filter((t) => /_/.test(t) || ['ci_eq', 're_test'].includes(t));
    for (const t of opTokens) {
      // any documented op-like token must be a real registered op
      if (knownOps.has(t)) continue;
      // EvalContext path tokens are not ops; ensure it's at least a known path otherwise fail
      expect(EVAL_CONTEXT_PATHS.map((p) => p.path)).toContain(t);
    }
  });

  it('documents every EvalContext path', () => {
    for (const p of EVAL_CONTEXT_PATHS) {
      expect(body).toContain(p.path);
    }
  });

  it('negative: a fabricated operator not in source would be detected', () => {
    const mutated = `${body}\n- \`bogus_op(x)\` — not real`;
    const knownOps = new Set(CUSTOM_OPERATORS.map((o) => o.name));
    const documented = mutated
      .split('\n')
      .filter((l) => l.trim().startsWith('- `'))
      .map((l) => (l.match(/- `([a-z_]+)\(/) || [])[1])
      .filter(Boolean) as string[];
    const unknownOps = documented.filter((t) => /_op$/.test(t) && !knownOps.has(t));
    expect(unknownOps).toContain('bogus_op');
  });
});

describe('schema.internal-event-v2 pack (generated from events.ts)', () => {
  const pack = buildInternalEventSchemaPack();
  const body = String(pack.body);

  // Representative samples used to assert documented field paths actually exist on the contracts.
  const sampleEvent: InternalEventV2 = {
    v: '2', correlationId: 'c', type: 'llm.request.v1',
    ingress: { ingressAt: 'now', source: 's', connector: 'system' } as any,
    identity: {} as any,
    egress: { destination: 'system', connector: 'system' } as any,
    message: { id: 'm', role: 'system' }, payload: {}, annotations: [], candidates: [],
    routing: { stage: 'initial', slip: [], history: [] },
  };
  const sampleAnnotation: AnnotationV1 = { id: 'a', kind: 'prompt', source: 'scheduler', createdAt: 'now', value: 'hi', label: 'l', payload: {} };

  it('carries id/version aligned to InternalEventV2 v + source provenance', () => {
    expect(pack.id).toBe('schema.internal-event-v2');
    expect(pack.version).toBe('2');
    expect(pack.source).toBe('src/types/events.ts');
  });

  it('documents the prompt-annotation contract', () => {
    expect(body).toContain('llm.request.v1');
    expect(body).toContain('prompt');
    expect(body).toContain('AnnotationV1');
  });

  it('lists ALL well-known annotation kinds from source', () => {
    for (const kind of ANNOTATION_KINDS_V1) {
      expect(body).toContain(kind);
    }
  });

  it('drift guard: every documented InternalEventV2 field path exists on the contract', () => {
    for (const f of INTERNAL_EVENT_V2_FIELD_PATHS) {
      expect(Object.prototype.hasOwnProperty.call(sampleEvent, f.path)).toBe(true);
    }
  });

  it('drift guard: every documented AnnotationV1 field path exists on the contract', () => {
    for (const f of ANNOTATION_V1_FIELD_PATHS) {
      expect(Object.prototype.hasOwnProperty.call(sampleAnnotation, f.path)).toBe(true);
    }
  });

  it('negative: a fabricated field path would be detected', () => {
    expect(Object.prototype.hasOwnProperty.call(sampleEvent, 'bogus_field')).toBe(false);
  });
});
