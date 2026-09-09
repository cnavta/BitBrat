import { Logger } from '../../common/logging';
import { PublisherResource } from '../../common/resources/publisher-manager';
import { InternalEventV2, INTERNAL_INGRESS_V1 } from '../../types/events';
import { busAttrsFromEvent } from '../../common/events/attributes';
import { publishPersistenceSnapshot } from '../../common/events/persistence-snapshots';
import { v4 as uuidv4 } from 'uuid';

export interface InboundFrame {
  type: string;
  payload: Record<string, any>;
  metadata?: {
    id?: string;
    timestamp?: string;
  };
}

export class IngressManager {
  constructor(
    private readonly publishers: PublisherResource,
    private readonly logger: Logger,
    private readonly egressDestinationTopic?: string
  ) {}

  /**
   * Processes an incoming message from a WebSocket client.
   * 1. Validates the JSON frame.
   * 2. Enriches with userId.
   * 3. Publishes to internal.ingress.v1.
   *
   * Sprint 39: Added permissions parameter for permission-gated features.
   *
   * @param userId - User ID from authentication
   * @param data - Raw JSON message data
   * @param permissions - User permissions array (Sprint 39)
   */
  public async handleMessage(userId: string, data: string, permissions: string[] = []): Promise<void> {
    try {
      const frame: InboundFrame = JSON.parse(data);
      if (!frame.type || !frame.payload) {
        throw new Error('Invalid message frame: missing type or payload');
      }

      this.logger.debug('ingress.message_received', { userId, type: frame.type });

      // Sprint 39: Route event.inject.v2 to specialized handler
      if (frame.type === 'event.inject.v2') {
        return await this.handleEventInject(userId, frame, permissions);
      }

      // Build InternalEventV2
      let type = frame.type as any;
      
      // Map external chat events to internal platform events if necessary
      if (type === 'chat.message.send') type = 'chat.message.v1';
      
      const event: InternalEventV2 = {
        v: '2',
        type: type,
        correlationId: frame.metadata?.id || uuidv4(),
        traceId: uuidv4(),
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'api-gateway',
          connector: 'api',
          channel: frame.payload.channel || frame.payload.room,
        },
        identity: {
          external: {
            id: userId,
            platform: 'api-gateway',
          }
        },
        egress: { 
          destination: this.egressDestinationTopic || 'api-gateway',
          type: 'chat',
          connector: 'api',
          channel: frame.payload.channel || frame.payload.room
        },
        message: (type === 'chat.message.v1' || type === 'chat.message.send') ? {
          id: frame.metadata?.id || uuidv4(),
          role: 'user',
          text: frame.payload.text,
          rawPlatformPayload: frame.payload
        } : undefined,
        payload: frame.payload,
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        }
      };

      const publisher = this.publishers.create(INTERNAL_INGRESS_V1);
      const attrs = busAttrsFromEvent(event);

      await publisher.publishJson(event, attrs);
      this.logger.info('ingress.published', { userId, type: event.type, correlationId: event.correlationId });

      // Publish initial snapshot for claim check pattern (Sprint 39 fix)
      try {
        await publishPersistenceSnapshot({
          config: (process.env as any),
          createPublisher: (subject: string) => this.publishers.create(subject),
          logger: this.logger as any,
          kind: 'initial',
          sourceService: 'api-gateway',
          sourceTopic: INTERNAL_INGRESS_V1,
          event,
          changeSummary: 'api gateway ingress',
        });
      } catch (snapshotErr: any) {
        // Fail-open: snapshot publishing failures shouldn't block ingress
        this.logger.warn('ingress.snapshot.publish_error', {
          error: snapshotErr.message,
          correlationId: event.correlationId,
        });
      }

    } catch (err: any) {
      this.logger.error('ingress.error', { userId, error: err.message });
      throw err;
    }
  }

  /**
   * Handles event.inject.v2 frame type - permission-gated event injection.
   *
   * Sprint 39: Allows authenticated dev-tools to inject arbitrary InternalEventV2
   * events with full control over ingress/egress/identity metadata for testing
   * and debugging purposes.
   *
   * SECURITY CRITICAL:
   * - Requires 'event:inject' permission
   * - Rejects anonymous users
   * - Validates event structure
   * - Prevents routing slip manipulation (always initializes to empty)
   * - Audit logs with dual identity (real user + emulated identity)
   *
   * @param userId - Authenticated user ID (NOT 'anonymous')
   * @param frame - InboundFrame with event.inject.v2 type
   * @param permissions - User permissions array
   * @throws Error if permission check fails or event invalid
   */
  private async handleEventInject(
    userId: string,
    frame: InboundFrame,
    permissions: string[]
  ): Promise<void> {
    // SECURITY: Check for event:inject permission
    if (!permissions || !permissions.includes('event:inject')) {
      this.logger.warn('ingress.event_inject_denied', {
        userId,
        reason: 'missing_permission',
        requiredPermission: 'event:inject',
        userPermissions: permissions || [],
      });

      throw new Error(
        'Permission denied: event.inject.v2 requires "event:inject" permission. ' +
        'This frame type is restricted to authenticated dev-tools and admin users.'
      );
    }

    // SECURITY: Validate userId is not anonymous (must be authenticated)
    if (userId === 'anonymous') {
      this.logger.warn('ingress.event_inject_denied', {
        userId,
        reason: 'anonymous_user',
      });

      throw new Error(
        'Permission denied: event.inject.v2 is not available for anonymous connections. ' +
        'Authenticate with a Bearer token that has "event:inject" permission.'
      );
    }

    // Validate payload structure
    if (!frame.payload.event) {
      throw new Error(
        'Invalid event.inject.v2 frame: payload.event is required. ' +
        'Expected structure: { type: "event.inject.v2", payload: { event: InternalEventV2 } }'
      );
    }

    // Extract pre-built event from payload
    const partialEvent: Partial<InternalEventV2> = frame.payload.event;

    // SECURITY: Validate connector if provided (prevent malicious connector forgery)
    const providedConnector = partialEvent.ingress?.connector;
    if (providedConnector) {
      const allowedConnectors = ['api', 'discord', 'twitch', 'twilio', 'slack'];
      if (!allowedConnectors.includes(providedConnector)) {
        this.logger.warn('ingress.event_inject_denied', {
          userId,
          reason: 'invalid_connector',
          providedConnector,
          allowedConnectors,
        });

        throw new Error(
          `Invalid connector: "${providedConnector}". Allowed connectors: ${allowedConnectors.join(', ')}`
        );
      }
    }

    // Merge with defaults (preserving provided values where present)
    const now = new Date().toISOString();
    const correlationId = partialEvent.correlationId || frame.metadata?.id || uuidv4();

    const event: InternalEventV2 = {
      v: '2',
      type: partialEvent.type || 'chat.message.v1',
      correlationId,
      traceId: partialEvent.traceId || uuidv4(),

      // Ingress: Use provided values or defaults
      ingress: {
        ingressAt: partialEvent.ingress?.ingressAt || now,
        source: partialEvent.ingress?.source || 'api-gateway',
        connector: partialEvent.ingress?.connector || 'api',
        channel: partialEvent.ingress?.channel,
      },

      // Identity: Use provided values or defaults
      identity: partialEvent.identity || {
        external: {
          id: userId,
          platform: 'api-gateway',
        }
      },

      // Egress: Use provided values or defaults
      egress: partialEvent.egress || {
        destination: this.egressDestinationTopic || 'api-gateway',
        type: 'chat',
        connector: 'api',
      },

      // Message: Use provided message
      message: partialEvent.message,

      // Payload: Use provided payload
      payload: partialEvent.payload,

      // Annotations: Use provided annotations or empty array
      annotations: partialEvent.annotations || [],

      // Candidates: Use provided candidates
      candidates: partialEvent.candidates,

      // SECURITY: ALWAYS initialize routing slip to prevent manipulation
      // This ensures event-router controls routing, not the client
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };

    // Audit log: Capture both real identity (userId) and emulated identity
    this.logger.info('ingress.event_inject', {
      realUserId: userId,
      emulatedIdentity: event.identity?.external?.id,
      emulatedPlatform: event.identity?.external?.platform,
      emulatedConnector: event.ingress.connector,
      type: event.type,
      correlationId: event.correlationId,
      permissions,
    });

    // Publish to internal.ingress.v1
    const publisher = this.publishers.create(INTERNAL_INGRESS_V1);
    const attrs = busAttrsFromEvent(event);

    await publisher.publishJson(event, attrs);

    this.logger.info('ingress.event_inject.published', {
      userId,
      type: event.type,
      correlationId: event.correlationId,
      connector: event.ingress.connector,
    });

    // Publish initial snapshot for claim check pattern (Sprint 39 fix)
    try {
      await publishPersistenceSnapshot({
        config: (process.env as any),
        createPublisher: (subject: string) => this.publishers.create(subject),
        logger: this.logger as any,
        kind: 'initial',
        sourceService: 'api-gateway',
        sourceTopic: INTERNAL_INGRESS_V1,
        event,
        changeSummary: 'api gateway event injection',
      });
    } catch (snapshotErr: any) {
      // Fail-open: snapshot publishing failures shouldn't block ingress
      this.logger.warn('ingress.event_inject.snapshot.publish_error', {
        error: snapshotErr.message,
        correlationId: event.correlationId,
      });
    }
  }
}
