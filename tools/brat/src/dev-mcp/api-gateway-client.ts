/**
 * ApiGatewayClient - WebSocket client for api-gateway communication
 *
 * Sprint 39: Dev MCP Messaging Tools
 *
 * Provides WebSocket connection management for sending messages and events
 * to BitBrat execution contexts via api-gateway.
 *
 * Key Features:
 * - WebSocket connection with Bearer token authentication
 * - Message sending with response correlation
 * - Timeout handling for requests
 * - Connection pooling (one client per context)
 *
 * Security:
 * - Requires Bearer token for authenticated access
 * - Supports anonymous mode (if enabled on gateway)
 * - Auto-handles event:inject permission for dev tokens
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../orchestration/logger';
import type { InternalEventV2 } from '../../../../src/types/events';

/**
 * Options for creating an ApiGatewayClient
 */
export interface ApiGatewayClientOptions {
  /** WebSocket URL (ws:// or wss://) */
  gatewayUrl: string;
  /** Bearer token for authentication (optional, for anonymous mode) */
  authToken?: string;
  /** Override userId (for brat-chat:* pattern) */
  userId?: string;
  /** Logger instance */
  logger: Logger;
  /** Enable automatic reconnection on disconnect (default: false) */
  autoReconnect?: boolean;
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** Message type (e.g., 'chat.message.v1') */
  type: string;
  /** Message payload */
  payload: Record<string, any>;
  /** Optional metadata */
  metadata?: {
    /** Correlation ID (auto-generated if not provided) */
    id?: string;
    /** Timestamp (auto-generated if not provided) */
    timestamp?: string;
    [key: string]: any;
  };
  /** Wait for response (default: true) */
  waitForResponse?: boolean;
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Options for sending an event
 */
export interface SendEventOptions {
  /** Partial InternalEventV2 to inject */
  event: Partial<InternalEventV2>;
  /** Wait for response (default: true) */
  waitForResponse?: boolean;
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * InboundFrame sent to api-gateway
 */
export interface InboundFrame {
  type: string;
  payload: Record<string, any>;
  metadata?: {
    id?: string;
    timestamp?: string;
    [key: string]: any;
  };
}

/**
 * Pending response tracker
 */
interface PendingResponse {
  resolve: (event: InternalEventV2) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * ApiGatewayClient
 *
 * WebSocket client for communicating with api-gateway service.
 * Supports message sending, response correlation, and timeout handling.
 *
 * @example
 * ```typescript
 * const client = new ApiGatewayClient({
 *   gatewayUrl: 'ws://localhost:3008',
 *   authToken: 'bearer-token',
 *   logger: createLogger(),
 * });
 *
 * await client.connect();
 *
 * const response = await client.sendMessage({
 *   type: 'chat.message.v1',
 *   payload: { text: 'Hello!' },
 *   waitForResponse: true,
 * });
 *
 * await client.disconnect();
 * ```
 */
export class ApiGatewayClient extends EventEmitter {
  private ws?: WebSocket;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private pendingResponses: Map<string, PendingResponse> = new Map();
  private readonly options: ApiGatewayClientOptions;

  /**
   * Create a new ApiGatewayClient
   *
   * @param options - Client configuration options
   */
  constructor(options: ApiGatewayClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Connect to api-gateway WebSocket endpoint
   *
   * Establishes WebSocket connection with optional Bearer token authentication.
   * Sets up event handlers for message processing.
   *
   * @throws {Error} If already connected or connecting
   * @throws {Error} If connection fails
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Already connected to api-gateway');
    }

    if (this.isConnecting) {
      throw new Error('Connection already in progress');
    }

    this.isConnecting = true;
    this.options.logger.info({
      gatewayUrl: this.options.gatewayUrl,
      hasAuthToken: !!this.options.authToken,
    }, 'Connecting to api-gateway');

    try {
      // Build WebSocket URL
      const url = new URL(this.options.gatewayUrl);
      url.pathname = '/ws/v1';

      // Add userId query param if provided
      if (this.options.userId) {
        url.searchParams.set('userId', this.options.userId);
      }

      // Create WebSocket with auth header
      const headers: Record<string, string> = {};
      if (this.options.authToken) {
        headers['Authorization'] = `Bearer ${this.options.authToken}`;
      }

      this.ws = new WebSocket(url.toString(), { headers });

      // Setup event handlers and wait for connection
      await this.setupWebSocketHandlers();

      this.isConnected = true;
      this.isConnecting = false;

      this.options.logger.info({
        gatewayUrl: url.toString(),
      }, 'Connected to api-gateway');
    } catch (err) {
      this.isConnecting = false;
      this.options.logger.error({
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to connect to api-gateway');
      throw err;
    }
  }

  /**
   * Disconnect from api-gateway
   *
   * Closes WebSocket connection and cleans up pending responses.
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected && !this.ws) {
      return;
    }

    this.options.logger.info('Disconnecting from api-gateway');

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.isConnected = false;
    this.cleanupPendingResponses();

    this.options.logger.info('Disconnected from api-gateway');
  }

  /**
   * Check if client is connected
   *
   * @returns true if connected to api-gateway
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Setup WebSocket event handlers
   *
   * Registers handlers for open, message, error, and close events.
   * Returns a promise that resolves when connection is established.
   *
   * @returns Promise that resolves on successful connection
   * @private
   */
  private setupWebSocketHandlers(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      // Connection opened
      this.ws.on('open', () => {
        this.isConnected = true;
        this.options.logger.debug('WebSocket connection opened');
        resolve();
      });

      // Message received
      this.ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString()) as InternalEventV2;
          this.handleIncomingMessage(event);
        } catch (err) {
          this.options.logger.error({
            error: err instanceof Error ? err.message : String(err),
          }, 'Failed to parse incoming message');
        }
      });

      // Error occurred
      this.ws.on('error', (err: Error) => {
        this.options.logger.error({
          error: err.message,
        }, 'WebSocket error');

        // Emit error event for consumers
        this.emit('error', err);

        // Reject connection promise if still connecting
        if (this.isConnecting) {
          reject(err);
        }
      });

      // Connection closed
      this.ws.on('close', () => {
        this.isConnected = false;
        this.options.logger.info('WebSocket connection closed');

        // Clean up pending responses
        this.cleanupPendingResponses();

        // Emit close event for consumers
        this.emit('close');
      });
    });
  }

  /**
   * Handle incoming message from api-gateway
   *
   * Matches message to pending request by correlationId and resolves promise.
   * If no pending request found, emits 'message' event.
   *
   * @param event - Incoming InternalEventV2 event or OutboundFrame
   * @private
   */
  private handleIncomingMessage(event: any): void {
    // Extract correlationId from either InternalEventV2 or OutboundFrame format
    // OutboundFrame: { metadata: { id: correlationId } }
    // InternalEventV2: { correlationId: correlationId }
    const correlationId = event.correlationId || event.metadata?.id;

    this.options.logger.debug({
      correlationId,
      type: event.type,
    }, 'Received message from api-gateway');

    if (!correlationId) {
      this.options.logger.warn({
        type: event.type,
      }, 'Received message without correlationId');
      return;
    }

    // Check if this is a response to a pending request
    const pending = this.pendingResponses.get(correlationId);
    if (pending) {
      // Clear timeout
      clearTimeout(pending.timeout);

      // Normalize to InternalEventV2-like structure for consistency
      // If it's an OutboundFrame, convert it
      const normalizedEvent: any = event.correlationId ? event : {
        ...event,
        correlationId,
        // Preserve original structure for access to payload/metadata
      };

      // Resolve promise
      pending.resolve(normalizedEvent as InternalEventV2);

      // Remove from pending
      this.pendingResponses.delete(correlationId);

      this.options.logger.debug({
        correlationId,
      }, 'Resolved pending response');
    } else {
      // Unsolicited message (broadcast, etc.)
      this.options.logger.debug({
        correlationId,
      }, 'Received unsolicited message');

      // Emit event for consumers
      this.emit('message', event);
    }
  }

  /**
   * Clean up all pending responses
   *
   * Called on disconnect to reject all pending promises.
   *
   * @private
   */
  private cleanupPendingResponses(): void {
    const count = this.pendingResponses.size;

    if (count > 0) {
      this.options.logger.warn({ count }, 'Cleaning up pending responses');

      for (const [correlationId, pending] of this.pendingResponses.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Connection closed before response received'));
      }

      this.pendingResponses.clear();
    }
  }

  /**
   * Send message and optionally wait for response
   *
   * Sends an InboundFrame message to api-gateway. If waitForResponse is true,
   * waits for a response with the same correlationId.
   *
   * @param options - Message options
   * @returns Promise resolving to response event, or null if not waiting
   * @throws {Error} If not connected
   * @throws {Error} If timeout occurs while waiting for response
   *
   * @example
   * ```typescript
   * const response = await client.sendMessage({
   *   type: 'chat.message.v1',
   *   payload: { text: 'Hello!' },
   *   waitForResponse: true,
   *   timeoutMs: 10000,
   * });
   * ```
   */
  async sendMessage(options: SendMessageOptions): Promise<InternalEventV2 | null> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to api-gateway');
    }

    // Generate correlationId if not provided
    const correlationId = options.metadata?.id || randomUUID();

    // Build InboundFrame
    const frame: InboundFrame = {
      type: options.type,
      payload: options.payload,
      metadata: {
        id: correlationId,
        timestamp: new Date().toISOString(),
        ...options.metadata,
      },
    };

    // Send message
    const frameJson = JSON.stringify(frame);
    this.ws.send(frameJson);

    this.options.logger.debug({
      correlationId,
      type: options.type,
    }, 'Sent message to api-gateway');

    // If not waiting for response, return null immediately
    if (options.waitForResponse === false) {
      return null;
    }

    // Wait for response with timeout
    return this.waitForResponse(correlationId, options.timeoutMs || 10000);
  }

  /**
   * Send event using event.inject.v2 frame type
   *
   * Sends a full InternalEventV2 event using the event.inject.v2 frame type,
   * which bypasses normal ingress normalization and preserves all metadata.
   *
   * **Security**: Requires "event:inject" permission on the authentication token.
   *
   * @param options - Event options
   * @returns Promise resolving to response event, or null if not waiting
   * @throws {Error} If not connected
   * @throws {Error} If permission denied
   * @throws {Error} If timeout occurs while waiting for response
   *
   * @example
   * ```typescript
   * const response = await client.sendEvent({
   *   event: {
   *     type: 'chat.message.v1',
   *     message: { text: '!help' },
   *     ingress: { connector: 'discord', source: 'ingress.discord' },
   *   },
   *   waitForResponse: true,
   * });
   * ```
   */
  async sendEvent(options: SendEventOptions): Promise<InternalEventV2 | null> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to api-gateway');
    }

    // Generate correlationId if not provided
    const correlationId = options.event.correlationId || randomUUID();

    // Build event.inject.v2 frame
    const frame: InboundFrame = {
      type: 'event.inject.v2',
      payload: {
        event: {
          ...options.event,
          correlationId,
        },
      },
      metadata: {
        id: correlationId,
        timestamp: new Date().toISOString(),
      },
    };

    // Send event
    const frameJson = JSON.stringify(frame);
    this.ws.send(frameJson);

    this.options.logger.debug({
      correlationId,
      type: options.event.type,
      connector: options.event.ingress?.connector,
    }, 'Sent event.inject.v2 to api-gateway');

    // If not waiting for response, return null immediately
    if (options.waitForResponse === false) {
      return null;
    }

    // Wait for response with timeout
    return this.waitForResponse(correlationId, options.timeoutMs || 10000);
  }

  /**
   * Wait for response with timeout
   *
   * Creates a promise that resolves when a message with the given correlationId
   * is received, or rejects after the specified timeout.
   *
   * @param correlationId - Correlation ID to wait for
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise resolving to response event
   * @private
   */
  private waitForResponse(correlationId: string, timeoutMs: number): Promise<InternalEventV2> {
    return new Promise((resolve, reject) => {
      // Setup timeout
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(correlationId);
        reject(new Error(`Response timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Store pending response
      this.pendingResponses.set(correlationId, {
        resolve,
        reject,
        timeout,
      });

      this.options.logger.debug({
        correlationId,
        timeoutMs,
      }, 'Waiting for response');
    });
  }
}
