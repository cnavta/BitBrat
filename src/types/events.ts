/**
 * Event subsystem types (Epic J)
 * Contracts align with planning/sprint-30/epics/epic-j-*.md
 */

export enum EventType {
  FOLLOW = 'FOLLOW',
  SUB = 'SUB',
  RESUB = 'RESUB',
  GIFT_SUB = 'GIFT_SUB',
  CHEER = 'CHEER',
  RAID = 'RAID',
  VIP_CHAT = 'VIP_CHAT',
  FIRST_CHAT = 'FIRST_CHAT',
  REDEEM = 'REDEEM',
  SHOUTOUT = 'SHOUTOUT',
}

export interface PromptTemplateConfig {
  name: string;
  text: string;
  variables: string[];
  maxTokens?: number;
  stopSequences?: string[];
}

export interface EventHandlerConditions {
  cooldownMs?: number;
  minBits?: number;
  isVipOnly?: boolean;
}

export interface EventHandlerConfig {
  key: EventType;
  enabled: boolean;
  description?: string;
  conditions?: EventHandlerConditions;
  template: PromptTemplateConfig;
  systemPrompt?: string;
  model?: { provider?: 'openai' | 'vertex'; name?: string; temperature?: number };
  safety?: { maxReplyLength?: number; profanityFilter?: boolean };
  outputRules?: { style?: string };
}

export interface MemoryProfile {
  profileSummary?: string;
  interestsTopK?: string[];
  recentInteraction?: string;
  lastSeen?: string; // ISO8601
}

export interface DispatchContext {
  // minimal context holder if needed later
  channel: string; // #channel
  correlationId?: string;
}

/**
 * Sprint 77 — Internal Event Contracts (v1)
 * These types define the envelope + routing slip pattern used across the message bus.
 * We intentionally avoid reusing the legacy EventType enum above to prevent breaking changes.
 * llm_prompt: prefer explicit, versioned contracts; propagate correlationId and traceparent.
 */
export type InternalEventType =
  | 'chat.message.v1'
  | 'chat.command.v1'
  | 'moderation.action.v1'
  | 'system.timer.v1'
  | 'llm.request.v1'
  | 'llm.response.v1'
  | 'router.route.v1'
  | 'egress.deliver.v1'
  | string;

export type RoutingStatus = 'PENDING' | 'OK' | 'ERROR' | 'SKIP';

export interface RoutingStep {
  id: string; // e.g., "router", "retrieval", "llm-bot", "formatter", "egress"
  v?: string; // step contract version (default "1")
  status: RoutingStatus;
  attempt?: number; // 0-based
  maxAttempts?: number; // default 3
  nextTopic?: string; // e.g., internal.bot.requests.v1
  attributes?: Record<string, string>;
  startedAt?: string; // ISO8601
  endedAt?: string; // ISO8601
  error?: { code: string; message?: string; retryable?: boolean } | null;
  notes?: string;
}

export interface EnvelopeV1 {
  v: '1';
  source: string; // e.g., "ingress.twitch"
  correlationId: string; // uuid
  traceId?: string; // w3c trace id
  replyTo?: string; // topic for direct reply if not default
  timeoutAt?: string; // optional absolute timeout for the end-to-end processing
  egressDestination?: string; // Destination that can to route external responses for a message, gernerally the ingress-egress instance the message arrived on.
  routingSlip?: RoutingStep[]; // at least one step after routing
  /** Optional: added by Auth service (User Enrichment v1) */
  user?: {
    id: string;
    email?: string;
    displayName?: string;
    roles?: string[];
    status?: string;
  };
  /** Optional: added by Auth service (User Enrichment v1) */
  auth?: {
    v: '1';
    provider?: string;
    method: 'enrichment';
    matched: boolean;
    userRef?: string; // e.g., users/<docId>
    at: string; // ISO timestamp
  };
}

export interface InternalEventV1 {
  envelope: EnvelopeV1;
  type: InternalEventType;
  channel?: string; // #channel if applicable
  userId?: string; // optional twitch user id, etc.
  payload: Record<string, any>;
}

/**
 * Sprint 107 — Internal Event Contracts (v2)
 * InternalEventV2 flattens the V1 envelope and introduces message/annotations/candidates.
 * This interface is the preferred shape for new services. V1 remains for backward compatibility.
 */
export interface MessageV1 {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  language?: string;
  rawPlatformPayload?: Record<string, any>;
}

export type AnnotationKindV1 = 'intent' | 'entities' | 'sentiment' | 'topic' | 'custom' | 'prompt' | 'personality' | string;

export interface AnnotationV1 {
  id: string;
  kind: AnnotationKindV1;
  source: string;
  createdAt: string; // ISO8601
  confidence?: number;
  label?: string;
  value?: string;
  score?: number;
  payload?: Record<string, any>;
}

export interface CandidateV1 {
  id: string;
  kind: 'text' | 'rich' | 'action' | string;
  source: string;
  createdAt: string; // ISO8601
  status: 'proposed' | 'selected' | 'superseded' | 'rejected';
  priority: number; // lower is higher priority
  confidence?: number;
  text?: string;
  format?: 'plain' | 'markdown' | 'html' | string;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface ErrorEntryV1 {
  source: string;
  message: string;
  fatal?: boolean;
  at: string; // ISO8601
}

/**
 * InternalEventV2 extends the EnvelopeV1 fields at the top level (no `envelope` nesting),
 * and adds normalized message metadata along with annotations and candidate replies.
 */
export interface InternalEventV2 extends EnvelopeV1 {
  type: InternalEventType;
  channel?: string; // #channel if applicable
  userId?: string; // optional twitch user id, etc.
  message: MessageV1;
  annotations?: AnnotationV1[];
  candidates?: CandidateV1[];
  errors?: ErrorEntryV1[];
}

// Topic/Subject constants (keep identical across drivers)
export const INTERNAL_INGRESS_V1 = 'internal.ingress.v1';
export const INTERNAL_ROUTES_V1 = 'internal.routes.v1';
export const INTERNAL_BOT_REQUESTS_V1 = 'internal.bot.requests.v1';
export const INTERNAL_BOT_RESPONSES_V1 = 'internal.bot.responses.v1';
export const INTERNAL_EGRESS_V1 = 'internal.egress.v1';
export const INTERNAL_DEADLETTER_V1 = 'internal.deadletter.v1';
// Router DLQ default target when no rules match (per sprint-100 technical architecture)
export const INTERNAL_ROUTER_DLQ_V1 = 'internal.router.dlq.v1';
// User-enriched stream default (Auth service output; Router default input per sprint-104)
export const INTERNAL_USER_ENRICHED_V1 = 'internal.user.enriched.v1';
// Command topic per architecture.yaml
export const INTERNAL_COMMAND_V1 = 'internal.command.v1';
