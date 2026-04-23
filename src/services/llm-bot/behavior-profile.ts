import { AnnotationV1 } from '../../types/events';

export type BehaviorIntent = 'question' | 'joke' | 'praise' | 'critique' | 'command' | 'meta' | 'spam';
export type BehaviorToneBucket = 'hostile' | 'negative' | 'neutral' | 'positive' | 'excited';
export type BehaviorRiskLevel = 'none' | 'low' | 'med' | 'high';
export type BehaviorRiskType = 'none' | 'harassment' | 'spam' | 'privacy' | 'self_harm' | 'sexual' | 'illegal';
export type BehaviorResponseMode = 'answer' | 'light_humor' | 'gratitude' | 'deescalate' | 'brief_comply' | 'meta_explain' | 'refuse' | 'ignore';
export type BehaviorGateDecision = 'PROCEED' | 'SAFE_REFUSAL' | 'NO_RESPONSE' | 'ESCALATE';
export type BehavioralRiskResponseMode = 'refuse' | 'safe-complete';

export interface BehaviorToneProfile {
  valence: number;
  arousal: number;
  bucket: BehaviorToneBucket;
  highArousal: boolean;
}

export interface BehaviorRiskProfile {
  level: BehaviorRiskLevel;
  type: BehaviorRiskType;
}

export interface BehaviorPolicy {
  shouldRespond: boolean;
  shouldUseTools: boolean;
  shouldDeescalate: boolean;
  shouldRefuse: boolean;
  requiresSafeCompletion: boolean;
  requiresEscalationAnnotation: boolean;
}

export interface BehaviorProfile {
  intent: BehaviorIntent;
  tone: BehaviorToneProfile;
  risk: BehaviorRiskProfile;
  policy: BehaviorPolicy;
  responseMode: BehaviorResponseMode;
  gate: BehaviorGateDecision;
}

export interface BehaviorProfileOptions {
  riskResponseMode?: BehavioralRiskResponseMode;
}

const VALID_INTENTS: readonly BehaviorIntent[] = ['question', 'joke', 'praise', 'critique', 'command', 'meta', 'spam'];
const VALID_RISK_LEVELS: readonly BehaviorRiskLevel[] = ['none', 'low', 'med', 'high'];
const VALID_RISK_TYPES: readonly BehaviorRiskType[] = ['none', 'harassment', 'spam', 'privacy', 'self_harm', 'sexual', 'illegal'];

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeRiskLevel(value: unknown): BehaviorRiskLevel {
  const normalized = normalizeText(value);
  if (!normalized) return 'none';
  if (normalized === 'medium') return 'med';
  if (VALID_RISK_LEVELS.includes(normalized as BehaviorRiskLevel)) return normalized as BehaviorRiskLevel;
  return 'none';
}

function normalizeRiskType(value: unknown): BehaviorRiskType {
  const normalized = normalizeText(value)?.replace(/[\s-]+/g, '_');
  if (!normalized) return 'none';
  if (VALID_RISK_TYPES.includes(normalized as BehaviorRiskType)) return normalized as BehaviorRiskType;
  return 'none';
}

function normalizeIntent(value: unknown): BehaviorIntent {
  const normalized = normalizeText(value);
  if (normalized && VALID_INTENTS.includes(normalized as BehaviorIntent)) {
    return normalized as BehaviorIntent;
  }
  return 'question';
}

function normalizeScore(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed > 1) return 1;
  if (parsed < -1) return -1;
  return parsed;
}

export function deriveToneBucket(valence: number, arousal: number): BehaviorToneBucket {
  if (arousal >= 0.7) return 'excited';
  if (valence <= -0.6) return 'hostile';
  if (valence < -0.2) return 'negative';
  if (valence <= 0.2) return 'neutral';
  return 'positive';
}

function responseModeFor(intent: BehaviorIntent, risk: BehaviorRiskProfile): BehaviorResponseMode {
  if (risk.level === 'high') return 'refuse';
  if (risk.level === 'med') {
    if (risk.type === 'self_harm' || risk.type === 'privacy' || risk.type === 'illegal' || risk.type === 'sexual') {
      return 'refuse';
    }
    if (risk.type === 'harassment') {
      return intent === 'spam' ? 'ignore' : 'deescalate';
    }
  }

  switch (intent) {
    case 'joke':
      return 'light_humor';
    case 'praise':
      return 'gratitude';
    case 'critique':
      return 'deescalate';
    case 'command':
      return 'brief_comply';
    case 'meta':
      return 'meta_explain';
    case 'spam':
      return 'ignore';
    case 'question':
    default:
      return 'answer';
  }
}

function policyFor(
  intent: BehaviorIntent,
  tone: BehaviorToneProfile,
  risk: BehaviorRiskProfile,
  responseMode: BehaviorResponseMode,
  options: BehaviorProfileOptions,
): BehaviorPolicy {
  const highRisk = risk.level === 'high';
  const mediumRisk = risk.level === 'med';
  const dangerousRisk = risk.type === 'self_harm' || risk.type === 'privacy' || risk.type === 'illegal' || risk.type === 'sexual';
  const requiresSafeCompletion = mediumRisk && (risk.type === 'self_harm' || (dangerousRisk && options.riskResponseMode === 'safe-complete'));
  const shouldRefuse = highRisk || dangerousRisk;
  const shouldRespond = !highRisk && intent !== 'spam';
  const shouldUseTools = !highRisk
    && !mediumRisk
    && intent !== 'spam'
    && !(intent === 'critique' && tone.highArousal)
    && risk.type !== 'privacy'
    && risk.type !== 'illegal'
    && risk.type !== 'self_harm'
    && risk.type !== 'sexual';
  const shouldDeescalate = responseMode === 'deescalate' || risk.type === 'harassment' || tone.bucket === 'hostile';

  return {
    shouldRespond,
    shouldUseTools,
    shouldDeescalate,
    shouldRefuse,
    requiresSafeCompletion,
    requiresEscalationAnnotation: highRisk,
  };
}

function gateFor(risk: BehaviorRiskProfile, intent: BehaviorIntent, policy: BehaviorPolicy): BehaviorGateDecision {
  if (risk.level === 'high') return 'ESCALATE';
  if (intent === 'spam') return 'NO_RESPONSE';
  if (policy.shouldRefuse || policy.requiresSafeCompletion) return 'SAFE_REFUSAL';
  return 'PROCEED';
}

function firstAnnotation(annotations: AnnotationV1[] | undefined, kind: string): AnnotationV1 | undefined {
  if (!Array.isArray(annotations)) return undefined;
  return annotations.find((annotation) => annotation?.kind === kind);
}

export function deriveBehaviorProfile(
  annotations: AnnotationV1[] | undefined,
  options: BehaviorProfileOptions = {},
): BehaviorProfile {
  const intentAnnotation = firstAnnotation(annotations, 'intent');
  const toneAnnotation = firstAnnotation(annotations, 'tone');
  const riskAnnotation = firstAnnotation(annotations, 'risk');

  const tonePayload = isRecord(toneAnnotation?.payload) ? toneAnnotation.payload : {};
  const riskPayload = isRecord(riskAnnotation?.payload) ? riskAnnotation.payload : {};

  const intent = normalizeIntent(intentAnnotation?.value ?? intentAnnotation?.label);
  const tone: BehaviorToneProfile = {
    valence: normalizeScore(tonePayload.valence),
    arousal: normalizeScore(tonePayload.arousal),
    highArousal: normalizeScore(tonePayload.arousal) >= 0.7,
    bucket: deriveToneBucket(normalizeScore(tonePayload.valence), normalizeScore(tonePayload.arousal)),
  };
  const risk: BehaviorRiskProfile = {
    level: normalizeRiskLevel(riskPayload.level ?? riskAnnotation?.label),
    type: normalizeRiskType(riskPayload.type),
  };

  const responseMode = responseModeFor(intent, risk);
  const policy = policyFor(intent, tone, risk, responseMode, {
    riskResponseMode: options.riskResponseMode ?? 'refuse',
  });

  return {
    intent,
    tone,
    risk,
    responseMode,
    policy,
    gate: gateFor(risk, intent, policy),
  };
}

export function buildBehavioralGuidance(profile: BehaviorProfile): string[] {
  const guidance = [
    `Detected user intent: ${profile.intent}.`,
    `Detected user tone: ${describeTone(profile.tone)}.`,
    `Detected safety risk: ${describeRisk(profile.risk)}.`,
  ];

  if (profile.policy.shouldDeescalate) {
    guidance.push('Respond calmly and non-defensively.');
  }
  if (!profile.policy.shouldUseTools) {
    guidance.push('Do not use tools for this request.');
  }
  if (profile.tone.highArousal) {
    guidance.push('Keep the response brief and avoid escalating language.');
  }
  if (profile.policy.requiresSafeCompletion) {
    guidance.push('If you respond, keep the reply brief, supportive, and safe.');
  }

  switch (profile.responseMode) {
    case 'light_humor':
      guidance.push('Use light humor without overcommitting or escalating the exchange.');
      break;
    case 'gratitude':
      guidance.push('Acknowledge the positive feedback warmly and succinctly.');
      break;
    case 'brief_comply':
      guidance.push('Comply only if the request is safe and in scope; otherwise explain the limit briefly.');
      break;
    case 'meta_explain':
      guidance.push('Be transparent about the bot or system behavior relevant to the request.');
      break;
    case 'refuse':
      guidance.push('Decline unsafe content clearly and without hostility.');
      break;
    default:
      break;
  }

  return guidance;
}

export function buildBehavioralTaskInstruction(profile: BehaviorProfile): string | undefined {
  switch (profile.responseMode) {
    case 'light_humor':
      return 'Reply with light humor while staying grounded and concise.';
    case 'gratitude':
      return 'Acknowledge the praise appreciatively and keep the conversation moving.';
    case 'deescalate':
      return 'Address the request constructively and without defensiveness.';
    case 'brief_comply':
      return 'Help briefly if the request is safe and in scope; otherwise explain the limit succinctly.';
    case 'meta_explain':
      return 'Explain the relevant bot or system behavior plainly and transparently.';
    case 'refuse':
      return 'Decline unsafe or disallowed content clearly, calmly, and briefly.';
    case 'ignore':
      return 'Do not provide a normal conversational answer to the user request.';
    case 'answer':
    default:
      return undefined;
  }
}

export function describeTone(tone: BehaviorToneProfile): string {
  const parts: string[] = [];

  if (tone.bucket === 'hostile') parts.push('strongly negative');
  else if (tone.bucket === 'negative') parts.push('negative');
  else if (tone.bucket === 'positive') parts.push('positive');
  else if (tone.bucket === 'excited') parts.push(tone.valence < -0.2 ? 'negative' : tone.valence > 0.2 ? 'positive' : 'neutral');
  else parts.push('neutral');

  parts.push(tone.highArousal ? 'high arousal' : 'steady arousal');
  return parts.join(' and ');
}

export function describeRisk(risk: BehaviorRiskProfile): string {
  if (risk.level === 'none') return 'none';
  if (risk.type === 'none') return risk.level;
  return `${risk.level} ${risk.type.replace(/_/g, ' ')}`;
}