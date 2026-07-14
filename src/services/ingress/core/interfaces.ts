import type { InternalEventV2 } from '../../../types/events';

export type ConnectorState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

/**
 * Event delivery method used by the connector
 *
 * @since Sprint 342
 */
export type EventDeliveryMethod = 'websocket' | 'webhook' | 'polling' | 'hybrid';

/**
 * Authentication method used by the connector
 *
 * @since Sprint 342
 */
export type AuthMethod = 'oauth2' | 'bot_token' | 'api_key' | 'bearer';

/**
 * Connector capabilities metadata
 *
 * Defines what features a platform integration supports.
 * Used for runtime capability queries and intelligent routing.
 *
 * @since Sprint 342
 */
export interface ConnectorCapabilities {
  /** Ingress (receiving messages) capabilities */
  ingress: {
    /** How events are delivered to the platform */
    method: EventDeliveryMethod;
    /** Whether events are delivered in real-time */
    realtime: boolean;
    /** Whether a webhook endpoint is required */
    requiresWebhook: boolean;
    /** Whether a public URL is required */
    requiresPublicUrl: boolean;
  };
  /** Egress (sending messages) capabilities */
  egress: {
    /** Supports sending to channels/rooms */
    chat: boolean;
    /** Supports direct messages */
    dm: boolean;
    /** Supports message reactions */
    reactions: boolean;
    /** Supports threaded replies */
    threads: boolean;
  };
  /** Moderation capabilities */
  moderation: {
    /** Supports banning users */
    ban: boolean;
    /** Supports timing out users */
    timeout: boolean;
    /** Supports deleting messages */
    delete: boolean;
  };
}

/**
 * Connector metadata
 *
 * Provides platform information and capabilities that can be queried at runtime.
 * Every connector SHOULD implement getMetadata() to return this information.
 *
 * @example
 * ```typescript
 * const metadata = slackConnector.getMetadata();
 * if (metadata.capabilities.egress.threads) {
 *   // Use threaded reply
 * }
 * ```
 *
 * @since Sprint 342
 */
export interface ConnectorMetadata {
  /** Platform name (e.g., 'slack', 'discord', 'twitch') */
  platform: string;
  /** Connector implementation version */
  version: string;
  /** Platform capabilities */
  capabilities: ConnectorCapabilities;
  /** Authentication method */
  authMethod: AuthMethod;
}

export interface ConnectorSnapshot {
  state: ConnectorState;
  lastError?: { code?: string; message: string } | null;
  counters?: Record<string, number>;
  [k: string]: unknown;
}

/**
 * Base interface for all ingress connectors
 *
 * Enhanced in Sprint 342 with optional getMetadata() method.
 * New connectors SHOULD implement getMetadata() for better observability.
 */
export interface IngressConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ConnectorSnapshot;

  /**
   * Get connector metadata (capabilities, platform info)
   *
   * OPTIONAL in Sprint 342 for backward compatibility.
   * Will be REQUIRED in Sprint 344 (Platform Convergence).
   *
   * @since Sprint 342
   */
  getMetadata?(): ConnectorMetadata;
}

export interface IngressPublisher {
  publish(evt: InternalEventV2): Promise<void>;
}

export interface EnvelopeBuilder<TMeta> {
  build(
    meta: TMeta,
    opts?: { uuid?: () => string; nowIso?: () => string; egressDestination?: string }
  ): InternalEventV2;
}

export interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;
  banUser?(platformUserId: string, reason?: string): Promise<void>;
}
