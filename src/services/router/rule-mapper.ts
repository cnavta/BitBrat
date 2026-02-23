import { AnnotationV1, CandidateV1 } from '../../types/events';
import { RuleDoc, RoutingStepRef } from './rule-loader';
import { logger } from '../../common/logging';

/**
 * Maps service names to internal topics as per technical architecture.
 */
export const SERVICE_TOPIC_MAP: Record<string, string> = {
  'llm-bot': 'internal.llmbot.v1',
  'auth': 'internal.auth.v1',
  'state-engine': 'internal.state.mutation.v1',
  'query-analyzer': 'internal.query.analysis.v1',
  'persistence': 'internal.persistence.finalize.v1',
};

/**
 * RuleMapper - Logic for mapping and creating rule documents.
 */
export class RuleMapper {
  /**
   * Constructs a RuleDoc from raw parameters.
   */
  public static mapToRuleDoc(params: {
    logic: string;
    services: string[];
    description?: string;
    priority?: number;
    promptTemplate?: string;
    responseTemplate?: string;
    customAnnotation?: { key: string; value: string };
  }): Partial<RuleDoc> {
    const {
      logic,
      services,
      description,
      priority = 100,
      promptTemplate,
      responseTemplate,
      customAnnotation,
    } = params;

    // 1. Validate logic (basic check, more robust validation could be added)
    try {
      JSON.parse(logic);
    } catch (e) {
      throw new Error(`Invalid logic: ${logic} is not a valid JSON string.`);
    }

    // 2. Generate Routing Slip
    const routingSlip: RoutingStepRef[] = services.map((svc) => {
      const sanitized = svc.toLowerCase().replace(/[^a-z0-9]/g, '');
      const nextTopic = SERVICE_TOPIC_MAP[svc] || `internal.${sanitized}.v1`;
      return {
        id: sanitized,
        nextTopic,
      };
    });

    // 3. Construct Enrichments
    const annotations: AnnotationV1[] = [];
    const candidates: CandidateV1[] = [];

    const now = new Date().toISOString();

    if (promptTemplate) {
      annotations.push({
        id: `ann-prompt-${Date.now()}`,
        kind: 'prompt',
        source: 'event-router.mcp',
        createdAt: now,
        value: promptTemplate,
      });
    }

    if (responseTemplate) {
      candidates.push({
        id: `cand-text-${Date.now()}`,
        kind: 'text',
        source: 'event-router.mcp',
        createdAt: now,
        status: 'proposed',
        priority: 1, // High priority for injected responses
        text: responseTemplate,
      });
    }

    if (customAnnotation) {
      annotations.push({
        id: `ann-custom-${Date.now()}`,
        kind: 'custom',
        source: 'event-router.mcp',
        createdAt: now,
        label: customAnnotation.key,
        value: customAnnotation.value,
      });
    }

    return {
      enabled: true,
      priority,
      description,
      logic,
      routingSlip,
      enrichments: {
        annotations: annotations.length ? annotations : undefined,
        candidates: candidates.length ? candidates : undefined,
      },
    };
  }
}
