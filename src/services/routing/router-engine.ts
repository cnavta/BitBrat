import { INTERNAL_ROUTER_DLQ_V1, InternalEventV2, RoutingStep, AnnotationV1 } from '../../types/events';
import type { RuleDoc, RoutingStepRef } from '../router/rule-loader';
import * as Eval from '../router/jsonlogic-evaluator';
import { logger } from '../../common/logging';

export interface RoutingDecisionMeta {
  matched: boolean;
  ruleId?: string;
  priority?: number;
  selectedTopic: string;
}

export interface RouteResult {
  slip: RoutingStep[];
  decision: RoutingDecisionMeta;
  evtOut: InternalEventV2;
}

export interface IJsonLogicEvaluator {
  buildContext: (evt: InternalEventV2, nowIso?: string, ts?: number) => Eval.EvalContext;
  evaluate: (logic: unknown, context: Eval.EvalContext) => boolean;
}

function normalizeSlip(refs: RoutingStepRef[]): RoutingStep[] {
  return refs.map((r) => ({
    id: r.id,
    v: r.v ?? '1',
    status: 'PENDING',
    attempt: 0,
    maxAttempts: r.maxAttempts ?? 3,
    nextTopic: r.nextTopic,
    attributes: r.attributes,
  }));
}

function defaultSlip(): RoutingStep[] {
  return [
    {
      id: 'router',
      v: '1',
      status: 'PENDING',
      attempt: 0,
      maxAttempts: 3,
      nextTopic: INTERNAL_ROUTER_DLQ_V1,
    },
  ];
}

/**
 * RouterEngine — first-match-wins with short-circuit and default path.
 * - Iterates provided rules in priority order (assumed sorted asc).
 * - On first truthy evaluation, selects that rule's routingSlip.
 * - If no rule matches, uses default slip to INTERNAL_ROUTER_DLQ_V1.
 * - Always normalizes slip entries: status=PENDING, attempt=0, v="1" when undefined.
 */
export class RouterEngine {
  constructor(private readonly evaluator: IJsonLogicEvaluator = Eval) {}

  route(evt: InternalEventV2, rules: ReadonlyArray<RuleDoc> = []): RouteResult {
    // Build evaluation context directly from V2
    const ctx = this.evaluator.buildContext(evt);

    // Prepare an immutable output copy; clone annotations array if present
    const evtOut: InternalEventV2 = {
      ...evt,
      annotations: evt.annotations ? [...evt.annotations] : undefined,
    };

    let chosen: RoutingStep[] | null = null;
    let meta: RoutingDecisionMeta | null = null;

    for (const rule of rules) {
      try {
        const ok = this.evaluator.evaluate(rule.logic, ctx);
        if (ok) {
          const slip = normalizeSlip(rule.routingSlip);
          const selectedTopic = slip[0]?.nextTopic || INTERNAL_ROUTER_DLQ_V1;
          meta = { matched: true, ruleId: rule.id, priority: rule.priority, selectedTopic };
          chosen = slip;
          // Enrich egress if rule defines one
          if (rule.egress) {
            evtOut.egress = rule.egress;
            logger.debug('router_engine.egress_enriched', {
              ruleId: rule.id,
              type: rule.egress.type,
              destination: rule.egress.destination,
            });
          }
          // Append annotations from rule if present
          const anns: AnnotationV1[] | undefined = rule.annotations && rule.annotations.length ? rule.annotations : undefined;
          if (anns && anns.length) {
            const before = evtOut.annotations?.length || 0;
            evtOut.annotations = [...(evtOut.annotations || []), ...anns];
            const after = evtOut.annotations.length;
            const appended = after - before;
            if (appended > 0) {
              logger.debug('router_engine.annotations_appended', {
                ruleId: rule.id,
                appended,
                before,
                after,
              });
            }
          }
          break; // short-circuit on first match
        }
      } catch (e: any) {
        logger.warn('router_engine.rule_eval_error', { id: rule.id, error: e?.message || String(e) });
      }
    }

    if (!chosen) {
      chosen = defaultSlip();
      meta = { matched: false, selectedTopic: chosen[0].nextTopic! };
    }

    return { slip: chosen, decision: meta!, evtOut };
  }
}

export default RouterEngine;
