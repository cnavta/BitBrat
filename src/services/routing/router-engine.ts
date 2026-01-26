import { INTERNAL_ROUTER_DLQ_V1, InternalEventV2, RoutingStep, AnnotationV1, MessageV1, CandidateV1 } from '../../types/events';
import type { RuleDoc, RoutingStepRef } from '../router/rule-loader';
import * as Eval from '../router/jsonlogic-evaluator';
import { logger } from '../../common/logging';
import Mustache from 'mustache';
import type { IConfig } from '../../types';

export interface RoutingDecisionMeta {
  matched: boolean;
  ruleId?: string;
  priority?: number;
  selectedTopic: string;
  matchedRuleIds: string[];
}

export interface RouteResult {
  slip: RoutingStep[];
  decision: RoutingDecisionMeta;
  evtOut: InternalEventV2;
}

export interface IStateStore {
  getLastCandidateId(userId: string, ruleId: string): Promise<string | undefined>;
  updateLastCandidateId(userId: string, ruleId: string, candidateId: string): Promise<void>;
}

export interface IJsonLogicEvaluator {
  buildContext: (evt: InternalEventV2, nowIso?: string, ts?: number, config?: IConfig) => Eval.EvalContext;
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
  constructor(
    private readonly evaluator: IJsonLogicEvaluator = Eval,
    private readonly stateStore?: IStateStore
  ) {}

  async route(evt: InternalEventV2, rules: ReadonlyArray<RuleDoc> = [], config?: IConfig): Promise<RouteResult> {
    // Build evaluation context directly from V2
    const ctx = this.evaluator.buildContext(evt, undefined, undefined, config);

    // Prepare an immutable output copy; clone annotations/candidates array if present
    const evtOut: InternalEventV2 = {
      ...evt,
      annotations: evt.annotations ? [...evt.annotations] : undefined,
      candidates: evt.candidates ? [...evt.candidates] : undefined,
    };

    let chosen: RoutingStep[] | null = null;
    let meta: RoutingDecisionMeta | null = null;
    const matchedRuleIds: string[] = [];

    for (const rule of rules) {
      try {
        const ok = this.evaluator.evaluate(rule.logic, ctx);
        if (ok) {
          matchedRuleIds.push(rule.id);

          if (!chosen) {
            const slip = normalizeSlip(rule.routingSlip);
            const selectedTopic = slip[0]?.nextTopic || INTERNAL_ROUTER_DLQ_V1;
            meta = { matched: true, ruleId: rule.id, priority: rule.priority, selectedTopic, matchedRuleIds };
            chosen = slip;

            const enrich = rule.enrichments;
            if (enrich) {
              // Build interpolation context: event context overrides rule metadata
              const interpCtx = { ...(rule.metadata || {}), ...ctx };

              // 1. Message Enrichment
              if (enrich.message) {
                const msg: MessageV1 = {
                  id: `rule-${rule.id}-${Date.now()}`,
                  role: 'assistant',
                  text: Mustache.render(enrich.message, interpCtx),
                };
                evtOut.message = msg;
              }

              // 2. Annotations Enrichment
              const rawAnns: AnnotationV1[] | undefined = enrich.annotations && enrich.annotations.length ? enrich.annotations : undefined;
              if (rawAnns && rawAnns.length) {
                const interpolatedAnns = rawAnns.map(a => ({
                  ...a,
                  label: a.label ? Mustache.render(a.label, interpCtx) : undefined,
                  value: a.value ? Mustache.render(a.value, interpCtx) : undefined,
                }));
                evtOut.annotations = [...(evtOut.annotations || []), ...interpolatedAnns];
              }

              // 3. Candidates Enrichment
              const rawCandidates: CandidateV1[] | undefined = enrich.candidates && enrich.candidates.length ? enrich.candidates : undefined;
              if (rawCandidates && rawCandidates.length) {
                const interpolatedCandidates = rawCandidates.map(c => ({
                  ...c,
                  text: c.text ? Mustache.render(c.text, interpCtx) : undefined,
                  reason: c.reason ? Mustache.render(c.reason, interpCtx) : undefined,
                }));

                if (enrich.randomCandidate && this.stateStore && evt.userId) {
                  const lastId = await this.stateStore.getLastCandidateId(evt.userId, rule.id);
                  const eligible = interpolatedCandidates.filter(c => c.id !== lastId);
                  const pool = eligible.length > 0 ? eligible : interpolatedCandidates;
                  const selected = pool[Math.floor(Math.random() * pool.length)];

                  evtOut.candidates = [...(evtOut.candidates || []), selected];
                  await this.stateStore.updateLastCandidateId(evt.userId, rule.id, selected.id);
                } else {
                  evtOut.candidates = [...(evtOut.candidates || []), ...interpolatedCandidates];
                }
              }

              // 4. Egress Enrichment
              if (enrich.egress) {
                evtOut.egress = {
                  ...enrich.egress,
                  destination: Mustache.render(enrich.egress.destination, interpCtx),
                };
              }
            }
          }
        }
      } catch (e: any) {
        logger.warn('router_engine.rule_eval_error', { id: rule.id, error: e?.message || String(e) });
      }
    }

    if (!chosen) {
      chosen = defaultSlip();
      meta = { matched: false, selectedTopic: chosen[0].nextTopic!, matchedRuleIds };
    }

    // Add routing metadata to event
    evtOut.metadata = {
      ...(evtOut.metadata || {}),
      matchedRuleIds,
      chosenRuleId: meta!.ruleId || null,
    };

    return { slip: chosen, decision: meta!, evtOut };
  }
}

export default RouterEngine;
