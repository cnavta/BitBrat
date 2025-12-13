import type { InternalEventV2 } from '../../types/events';

export const COLLECTION_EVENTS = 'events';

export interface EventDocV1 {
  correlationId: string;
  type?: string;
  channel?: string;
  userId?: string;
  message?: any;
  annotations?: any[];
  candidates?: any[];
  errors?: any[];
  egressDestination?: string;
  status?: 'INGESTED' | 'FINALIZED' | 'ERROR' | string;
  ingestedAt: string; // ISO8601
  finalizedAt?: string; // ISO8601
  raw?: any; // original event payload for debugging
  egress?: {
    destination?: string;
    deliveredAt?: string; // ISO8601
    providerMessageId?: string;
    status?: string;
    error?: { code: string; message?: string } | null;
    metadata?: Record<string, any>;
  };
}

export interface FinalizationUpdateV1 {
  correlationId: string;
  destination?: string;
  deliveredAt?: string; // ISO8601
  providerMessageId?: string;
  status?: string; // e.g., SENT, FAILED
  error?: { code: string; message?: string } | null;
  metadata?: Record<string, any>;
}

export function normalizeIngressEvent(evt: InternalEventV2): EventDocV1 {
  const now = new Date().toISOString();
  return {
    correlationId: String((evt as any)?.correlationId || ''),
    type: (evt as any)?.type,
    channel: (evt as any)?.channel,
    userId: (evt as any)?.userId,
    message: (evt as any)?.message,
    annotations: (evt as any)?.annotations,
    candidates: (evt as any)?.candidates,
    errors: (evt as any)?.errors,
    egressDestination: (evt as any)?.egressDestination,
    status: 'INGESTED',
    ingestedAt: now,
    raw: evt,
  };
}

export function normalizeFinalizePayload(msg: any): FinalizationUpdateV1 {
  const deliveredAt = msg?.deliveredAt || msg?.finalizedAt || new Date().toISOString();
  const destination = msg?.destination || msg?.egressDestination || msg?.egress?.destination;
  const providerMessageId = msg?.providerMessageId || msg?.egress?.providerMessageId;
  const status = msg?.status || msg?.egress?.status || 'FINALIZED';
  const error = msg?.error || msg?.egress?.error || null;
  const metadata = msg?.metadata || msg?.egress?.metadata || undefined;
  return {
    correlationId: String(msg?.correlationId || ''),
    destination,
    deliveredAt,
    providerMessageId,
    status,
    error,
    metadata,
  };
}
