import { INTERNAL_ROUTER_DLQ_V1, InternalEventV1, RoutingStep } from '../../types/events';
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
}

export interface IJsonLogicEvaluator {
  buildContext: (evt: InternalEventV1, nowIso?: string, ts?: number) => Eval.EvalContext;
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

  route(evt: InternalEventV1, rules: ReadonlyArray<RuleDoc> = []): RouteResult {
    const ctx = this.evaluator.buildContext(evt);

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

    return { slip: chosen, decision: meta! };
  }
}

export default RouterEngine;
