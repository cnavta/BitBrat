import type {
  DispositionBand,
  DispositionConfig,
  DispositionFlag,
  DispositionObservationEventV1,
  DispositionSnapshotV1,
} from '../../types/disposition';
import { normalizeRiskLevel } from '../../types/disposition';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(4));
}

function ratio(part: number, total: number): number {
  if (!total) return 0;
  return clamp01(part / total);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeDispositionSnapshot(
  observations: DispositionObservationEventV1[],
  config: DispositionConfig,
  nowIso: string = new Date().toISOString()
): DispositionSnapshotV1 {
  const cutoffMs = Date.parse(nowIso) - config.windowMs;
  const sorted = [...observations]
    .filter((observation) => Date.parse(observation.observedAt) >= cutoffMs)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
    .slice(0, config.maxEvents)
    .reverse();

  const messageCount = sorted.length;
  const expiresAt = new Date(Date.parse(nowIso) + config.snapshotTtlMs).toISOString();
  const windowStart = messageCount > 0 ? sorted[0].observedAt : new Date(cutoffMs).toISOString();

  if (messageCount < config.minEvents) {
    return {
      band: 'insufficient-signal',
      asOf: nowIso,
      window: {
        startAt: windowStart,
        endAt: nowIso,
        messageCount,
        windowMs: config.windowMs,
        maxEvents: config.maxEvents,
      },
      indicators: {
        supportivenessIndex: 0,
        frictionIndex: 0,
        agitationIndex: 0,
        spamIndex: 0,
        safetyConcernIndex: 0,
        confidence: clamp01(messageCount / Math.max(config.minEvents, 1)),
      },
      flags: [],
      expiresAt,
    };
  }

  const positiveValence = sorted.map((item) => Math.max(Number(item.analysis.tone?.valence || 0), 0));
  const negativeValence = sorted.map((item) => Math.max(-Number(item.analysis.tone?.valence || 0), 0));
  const arousal = sorted.map((item) => clamp01(Number(item.analysis.tone?.arousal || 0)));

  const praiseIntentCount = sorted.filter((item) => item.analysis.intent === 'praise').length;
  const critiqueIntentCount = sorted.filter((item) => item.analysis.intent === 'critique').length;
  const spamIntentCount = sorted.filter((item) => item.analysis.intent === 'spam').length;
  const harassmentRiskCount = sorted.filter((item) => item.analysis.risk?.type === 'harassment').length;
  const spamRiskCount = sorted.filter((item) => item.analysis.risk?.type === 'spam').length;
  const highArousalNegativeCount = sorted.filter((item) => {
    const valence = Number(item.analysis.tone?.valence || 0);
    const excitement = Number(item.analysis.tone?.arousal || 0);
    return valence < 0 && excitement >= 0.65;
  }).length;
  const highRiskPresent = sorted.some((item) => normalizeRiskLevel(item.analysis.risk?.level) === 'high');
  const mediumRiskCount = sorted.filter((item) => ['med', 'high'].includes(normalizeRiskLevel(item.analysis.risk?.level))).length;

  const supportivenessIndex = clamp01(
    0.6 * average(positiveValence) +
    0.4 * ratio(praiseIntentCount, messageCount)
  );

  const frictionIndex = clamp01(
    0.45 * average(negativeValence) +
    0.25 * ratio(harassmentRiskCount, messageCount) +
    0.2 * ratio(highArousalNegativeCount, messageCount) +
    0.1 * ratio(critiqueIntentCount, messageCount)
  );

  const agitationIndex = clamp01(
    0.5 * ratio(highArousalNegativeCount, messageCount) +
    0.3 * average(arousal) +
    0.2 * average(negativeValence)
  );

  const spamIndex = clamp01(
    0.7 * ratio(spamIntentCount, messageCount) +
    0.3 * ratio(spamRiskCount, messageCount)
  );

  const safetyConcernIndex = clamp01(
    0.75 * ratio(mediumRiskCount, messageCount) +
    (highRiskPresent ? 0.25 : 0)
  );

  const confidence = clamp01(
    0.6 * ratio(messageCount, config.maxEvents) +
    0.4 * Math.max(supportivenessIndex, frictionIndex, agitationIndex, spamIndex, safetyConcernIndex)
  );

  let band: DispositionBand = 'neutral';
  if (highRiskPresent || safetyConcernIndex >= 0.8) {
    band = 'high-risk';
  } else if (spamIndex >= 0.55) {
    band = 'spammy';
  } else if (agitationIndex >= 0.65) {
    band = 'agitated';
  } else if (frictionIndex >= 0.55) {
    band = 'frustrated';
  } else if (supportivenessIndex >= 0.55 && supportivenessIndex > frictionIndex && supportivenessIndex > agitationIndex) {
    band = 'supportive';
  }

  const flags = new Set<DispositionFlag>();
  if (band === 'frustrated' || band === 'agitated' || band === 'high-risk') flags.add('deescalate');
  if (band === 'frustrated' || band === 'agitated') flags.add('avoid-humor');
  if (band === 'agitated' || band === 'high-risk') flags.add('restrict-tools');
  if (band === 'high-risk') flags.add('monitor-safety');
  if (band === 'spammy') flags.add('limit-tool-calls');

  return {
    band,
    asOf: nowIso,
    window: {
      startAt: windowStart,
      endAt: nowIso,
      messageCount,
      windowMs: config.windowMs,
      maxEvents: config.maxEvents,
    },
    indicators: {
      supportivenessIndex,
      frictionIndex,
      agitationIndex,
      spamIndex,
      safetyConcernIndex,
      confidence,
    },
    flags: Array.from(flags),
    expiresAt,
  };
}