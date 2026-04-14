import type { InternalEventV2 } from '../../types/events';
import type { QueryAnalysis } from '../query-analyzer/llm-provider';
import type { DispositionObservationEventV1 } from '../../types/disposition';
import { normalizeRiskLevel } from '../../types/disposition';

export function deriveDispositionUserKey(evt: Pick<InternalEventV2, 'identity'>): string | null {
  const userId = evt.identity?.user?.id;
  if (userId) return userId;

  const platform = evt.identity?.external?.platform;
  const externalId = evt.identity?.external?.id;
  if (platform && externalId) return `${platform}:${externalId}`;

  return null;
}

export function buildDispositionObservationEvent(
  evt: InternalEventV2,
  analysis: QueryAnalysis,
  source: string,
  observedAt: string = new Date().toISOString()
): DispositionObservationEventV1 | null {
  const userKey = deriveDispositionUserKey(evt);
  if (!userKey) return null;

  return {
    v: '1',
    correlationId: evt.correlationId,
    observedAt,
    userKey,
    identity: {
      userId: evt.identity?.user?.id,
      external: evt.identity?.external?.platform && evt.identity?.external?.id
        ? {
            platform: evt.identity.external.platform,
            id: evt.identity.external.id,
          }
        : undefined,
    },
    message: {
      id: evt.message?.id,
      textLength: evt.message?.text?.length || 0,
      language: evt.message?.language,
    },
    analysis: {
      intent: analysis.intent,
      tone: {
        valence: Number(analysis.tone?.valence || 0),
        arousal: Number(analysis.tone?.arousal || 0),
      },
      risk: {
        level: normalizeRiskLevel(analysis.risk?.level),
        type: analysis.risk?.type,
      },
      entities: analysis.entities,
      topic: analysis.topic,
    },
    source,
  };
}