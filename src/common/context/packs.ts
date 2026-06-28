// Generated Context Packs (sprint-328, ADR §5.4 — P3)
//
// These packs are GENERATED at module-load from the source of truth, not hand-copied (Immutable
// Law #2 / G2 / G6):
//   - schema.internal-event-v2  <- src/types/events.ts (ANNOTATION_KINDS_V1 + the field-path specs below)
//   - router.jsonlogic-guide    <- src/services/router/jsonlogic-evaluator.ts (CUSTOM_OPERATORS + EVAL_CONTEXT_PATHS)
// Drift-guard tests (tests/common/context/*) assert every documented kind / field path / operator
// still exists in source, so a rename or removal fails CI rather than silently rotting the docs.

import { ANNOTATION_KINDS_V1 } from '../../types/events';
import { CUSTOM_OPERATORS, EVAL_CONTEXT_PATHS } from '../../services/router/jsonlogic-evaluator';
import type { ContextPack } from './types';

/** Stable pack ids (referenced by bindings, resources and tests). */
export const SCHEMA_INTERNAL_EVENT_V2_PACK_ID = 'schema.internal-event-v2';
export const ROUTER_JSONLOGIC_GUIDE_PACK_ID = 'router.jsonlogic-guide';

/** Stable MCP Resource URIs that expose the packs for tool turns (P0). */
export const SCHEMA_INTERNAL_EVENT_V2_RESOURCE_URI = 'context://schema/internal-event-v2';
export const ROUTER_JSONLOGIC_GUIDE_RESOURCE_URI = 'context://router/jsonlogic-guide';

/**
 * Field paths the schema pack documents, grouped by the contract they belong to. Exported so the
 * drift guard can assert each path exists on a representative InternalEventV2 / AnnotationV1.
 */
export const INTERNAL_EVENT_V2_FIELD_PATHS: ReadonlyArray<{ path: string; note: string }> = [
  { path: 'v', note: 'Schema version, always "2".' },
  { path: 'correlationId', note: 'UUID correlating all events for one interaction.' },
  { path: 'type', note: 'InternalEventType, e.g. "llm.request.v1" or "chat.message.v1".' },
  { path: 'identity', note: 'Identity (user / auth / external).' },
  { path: 'ingress', note: 'Ingress descriptor (source/channel/connector).' },
  { path: 'egress', note: 'Egress descriptor (destination/connector).' },
  { path: 'message', note: 'Optional MessageV1 for chat/text events.' },
  { path: 'payload', note: 'Optional fallback payload for system/non-message events.' },
  { path: 'annotations', note: 'AnnotationV1[] — typed annotations (see kinds below).' },
  { path: 'candidates', note: 'CandidateV1[] — proposed responses/actions.' },
  { path: 'routing', note: 'Routing { stage, slip[], history[] }.' },
];

export const ANNOTATION_V1_FIELD_PATHS: ReadonlyArray<{ path: string; note: string }> = [
  { path: 'id', note: 'Unique annotation id.' },
  { path: 'kind', note: 'AnnotationKindV1 (see list below).' },
  { path: 'source', note: 'Producer of the annotation, e.g. "scheduler".' },
  { path: 'createdAt', note: 'ISO8601 creation timestamp.' },
  { path: 'value', note: 'Optional string value (e.g. the prompt text).' },
  { path: 'label', note: 'Optional label.' },
  { path: 'payload', note: 'Optional structured payload.' },
];

function renderInternalEventSchemaMarkdown(): string {
  const kinds = ANNOTATION_KINDS_V1.join('`, `');
  const eventFields = INTERNAL_EVENT_V2_FIELD_PATHS.map((f) => `- \`${f.path}\` — ${f.note}`).join('\n');
  const annFields = ANNOTATION_V1_FIELD_PATHS.map((f) => `- \`${f.path}\` — ${f.note}`).join('\n');
  return [
    'To produce an event, emit an `InternalEventV2`. A **prompt is not an event `type`** — it is an',
    '`AnnotationV1` of `kind: "prompt"`. To "schedule a prompt", use `type: "llm.request.v1"` with an',
    'annotation `{ kind: "prompt", value: "<text>", source: "scheduler", id, createdAt }`.',
    '',
    '**InternalEventV2 fields:**',
    eventFields,
    '',
    '**AnnotationV1 fields** (`annotations` is an `AnnotationV1[]`, not a free-form bag):',
    annFields,
    '',
    `**Valid annotation kinds:** \`${kinds}\` (plus service-defined custom kinds).`,
  ].join('\n');
}

function renderRouterJsonLogicMarkdown(): string {
  const paths = EVAL_CONTEXT_PATHS.map((p) => `- \`${p.path}\` — ${p.note}`).join('\n');
  const ops = CUSTOM_OPERATORS.map((o) => `- \`${o.signature}\` — ${o.description}`).join('\n');
  return [
    'Author the rule `logic` as a JsonLogic expression (JSON string). It is evaluated against an',
    'event-derived context. `services` become the routing slip (via RuleMapper/SERVICE_TOPIC_MAP);',
    '`customAnnotation` attaches an `AnnotationV1`; `promptTemplate` adds a prompt annotation.',
    '',
    '**Available context paths:**',
    paths,
    '',
    '**Custom operators (in addition to standard JsonLogic):**',
    ops,
  ].join('\n');
}

/** Build the generated `schema.internal-event-v2` ContextPack. */
export function buildInternalEventSchemaPack(): ContextPack {
  return {
    id: SCHEMA_INTERNAL_EVENT_V2_PACK_ID,
    version: '2', // aligns with InternalEventV2 'v'
    title: 'Event Schema v2 (InternalEventV2 / AnnotationV1)',
    priority: 2,
    format: 'markdown',
    body: renderInternalEventSchemaMarkdown(),
    source: 'src/types/events.ts',
  };
}

/** Build the generated `router.jsonlogic-guide` ContextPack. */
export function buildRouterJsonLogicPack(): ContextPack {
  return {
    id: ROUTER_JSONLOGIC_GUIDE_PACK_ID,
    version: '1',
    title: 'JsonLogic for Routing (EvalContext paths + custom operators)',
    priority: 2,
    format: 'markdown',
    body: renderRouterJsonLogicMarkdown(),
    source: 'src/services/router/jsonlogic-evaluator.ts',
  };
}
