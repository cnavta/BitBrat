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
  | 'twitch.eventsub.v1'
  | 'system.source.status'
  | 'system.stream.online'
  | 'system.stream.offline'
  | 'token.created.v1'
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

export interface Egress {
  destination: string; // Destination that was the entry point for the message.
  type?: 'chat' | 'dm' | 'event'; // Requested type of response to send.
}

export interface Ingress {
  ingressAt: string; // ISO8601
  source: string;    // e.g., "ingress.twitch", "api-gateway"
  channel?: string;  // #channel or room ID
}

export interface Identity {
  /** 
   * Provided by Ingress. 
   * Processes should map platform-specific user info here.
   */
  external: {
    id: string;
    platform: string;
    displayName?: string;
    roles?: string[];
    metadata?: Record<string, any>;
  };

  /** 
   * Provided by Auth Service (Enrichment).
   * Maps internal user database information.
   */
  user?: {
    id: string;
    email?: string;
    displayName?: string;
    roles?: string[];
    status?: string;
    notes?: string;
    tags?: string[];
  };

  /** 
   * Provided by Auth Service.
   * Authentication process details.
   */
  auth?: {
    v: '2';
    provider?: string;
    method: 'enrichment';
    matched: boolean;
    userRef?: string;
    at: string;
  };
}

/**
 * Sprint 107 — Internal Event Contracts (v2)
 * InternalEventV2 flattens the V1 envelope and introduces message/annotations/candidates.
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

export interface QOSV1 {
  ttl?: number; // seconds
}

/**
 * Sprint 152 — Behavioral Event Support
 */
export interface ExternalEventV1 {
  id: string; // Platform-specific event ID
  source: string; // e.g., "twitch.eventsub"
  kind: string; // e.g., "channel.follow", "channel.update"
  version: string; // Event schema version from the platform
  createdAt: string; // ISO8601
  metadata?: Record<string, any>; // Grouped metadata (formerly payload)
  rawPayload?: Record<string, any>; // Optional original platform payload
}

/**
 * InternalEventV2 (Refactored)
 * Consolidated version incorporating legacy envelope fields at the root.
 */
export interface InternalEventV2 {
  v: '2';
  correlationId: string; // uuid
  traceId?: string; // w3c trace id
  type: InternalEventType;
  ingress: Ingress;
  identity: Identity;
  egress: Egress;

  externalEvent?: ExternalEventV1; // Optional: present for behavioral events
  message?: MessageV1; // Optional: present for chat/text events
  payload?: Record<string, any>; // Optional: fallback for system or non-message events

  annotations?: AnnotationV1[];
  candidates?: CandidateV1[];
  qos?: QOSV1;

  routingSlip?: RoutingStep[]; // at least one step after routing
  errors?: ErrorEntryV1[];
  metadata?: Record<string, any>;
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
