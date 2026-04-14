export const INTERNAL_USER_DISPOSITION_OBSERVATION_V1 = 'internal.user.disposition.observation.v1';
export const INTERNAL_USER_DISPOSITION_UPDATED_V1 = 'internal.user.disposition.updated.v1';

export const DISPOSITION_OBSERVATION_COLLECTION = 'user_disposition_observations';
export const DISPOSITION_STATE_KEY_PREFIX = 'user.disposition.';

export type DispositionBand =
  | 'supportive'
  | 'neutral'
  | 'frustrated'
  | 'agitated'
  | 'spammy'
  | 'high-risk'
  | 'insufficient-signal';

export type DispositionFlag =
  | 'deescalate'
  | 'avoid-humor'
  | 'restrict-tools'
  | 'monitor-safety'
  | 'limit-tool-calls';

export type DispositionRiskLevel = 'none' | 'low' | 'med' | 'medium' | 'high' | string;

export interface DispositionObservationIdentity {
  userId?: string;
  external?: {
    platform: string;
    id: string;
  };
}

export interface DispositionObservationMessage {
  id?: string;
  textLength: number;
  language?: string;
}

export interface DispositionObservationAnalysis {
  intent: string;
  tone: {
    valence: number;
    arousal: number;
  };
  risk: {
    level: DispositionRiskLevel;
    type?: string;
  };
  entities?: {
    text: string;
    type: string;
  }[];
  topic?: string;
}

export interface DispositionObservationEventV1 {
  v: '1';
  correlationId: string;
  observedAt: string;
  userKey: string;
  identity: DispositionObservationIdentity;
  message: DispositionObservationMessage;
  analysis: DispositionObservationAnalysis;
  source: string;
}

export interface StoredDispositionObservation extends DispositionObservationEventV1 {
  expireAt: string;
  sourcePlatform?: string;
  internalUserId?: string;
}

export interface DispositionIndicators {
  supportivenessIndex: number;
  frictionIndex: number;
  agitationIndex: number;
  spamIndex: number;
  safetyConcernIndex: number;
  confidence: number;
}

export interface DispositionWindowSummary {
  startAt: string;
  endAt: string;
  messageCount: number;
  windowMs: number;
  maxEvents: number;
}

export interface DispositionSnapshotV1 {
  band: DispositionBand;
  asOf: string;
  window: DispositionWindowSummary;
  indicators: DispositionIndicators;
  flags: DispositionFlag[];
  expiresAt: string;
}

export interface DispositionUpdatedEventV1 {
  v: '1';
  correlationId: string;
  userKey: string;
  snapshot: DispositionSnapshotV1;
  source: string;
  publishedAt: string;
}

export interface DispositionConfig {
  enabled: boolean;
  windowMs: number;
  maxEvents: number;
  minEvents: number;
  snapshotTtlMs: number;
  publishUpdates: boolean;
  promptInjectionEnabled: boolean;
  moderationAssistEnabled: boolean;
}

export const DEFAULT_DISPOSITION_CONFIG: DispositionConfig = {
  enabled: true,
  windowMs: 15 * 60 * 1000,
  maxEvents: 20,
  minEvents: 3,
  snapshotTtlMs: 20 * 60 * 1000,
  publishUpdates: false,
  promptInjectionEnabled: true,
  moderationAssistEnabled: false,
};

export function dispositionStateKey(userKey: string): string {
  return `${DISPOSITION_STATE_KEY_PREFIX}${userKey}`;
}

export function dispositionObservationDocumentId(userKey: string, correlationId: string): string {
  return `obs_${userKey}_${correlationId}`;
}

export function normalizeRiskLevel(level?: string): string {
  if (!level) return 'none';
  const value = String(level).toLowerCase();
  if (value === 'medium') return 'med';
  return value;
}

export function getDispositionConfig(read: <T>(name: string, fallback: T) => T): DispositionConfig {
  return {
    enabled: read('DISPOSITION_ENABLED', DEFAULT_DISPOSITION_CONFIG.enabled),
    windowMs: read('DISPOSITION_WINDOW_MS', DEFAULT_DISPOSITION_CONFIG.windowMs),
    maxEvents: read('DISPOSITION_MAX_EVENTS', DEFAULT_DISPOSITION_CONFIG.maxEvents),
    minEvents: read('DISPOSITION_MIN_EVENTS', DEFAULT_DISPOSITION_CONFIG.minEvents),
    snapshotTtlMs: read('DISPOSITION_SNAPSHOT_TTL_MS', DEFAULT_DISPOSITION_CONFIG.snapshotTtlMs),
    publishUpdates: read('DISPOSITION_PUBLISH_UPDATES', DEFAULT_DISPOSITION_CONFIG.publishUpdates),
    promptInjectionEnabled: read('DISPOSITION_PROMPT_INJECTION_ENABLED', DEFAULT_DISPOSITION_CONFIG.promptInjectionEnabled),
    moderationAssistEnabled: read('DISPOSITION_MODERATION_ASSIST_ENABLED', DEFAULT_DISPOSITION_CONFIG.moderationAssistEnabled),
  };
}