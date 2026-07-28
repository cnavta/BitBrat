/**
 * Debug Mode Test Utilities and Fixtures (Sprint 371)
 *
 * Reusable helpers for testing debug mode functionality across Slack connector tests.
 *
 * @since Sprint 371
 */

import { randomUUID } from 'crypto';
import type { InternalEventV2, DebugMetadata } from '../../../../types/events';

/**
 * Create a debug-enabled InternalEventV2 event for testing
 *
 * @param overrides - Optional field overrides
 * @returns InternalEventV2 with debug metadata and qos.tracer=true
 *
 * @example
 * ```typescript
 * const debugEvent = createDebugEvent({
 *   message: { id: 'msg123', role: 'user', text: 'test message' }
 * });
 * expect(debugEvent.qos?.tracer).toBe(true);
 * expect(debugEvent.metadata?.debug?.enabled).toBe(true);
 * ```
 */
export function createDebugEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  const correlationId = randomUUID();
  const now = new Date().toISOString();

  const debugMetadata: DebugMetadata = {
    enabled: true,
    initiatedBy: 'U0123456789', // Slack User ID format
    feedbackChannel: 'C9876543210', // Slack Channel ID format
    startedAt: now,
    ...(overrides.metadata?.debug || {}),
  };

  return {
    v: '2',
    correlationId,
    traceId: randomUUID(),
    type: 'chat.message.v1',
    ingress: {
      ingressAt: now,
      source: 'ingress.slack',
      connector: 'slack',
      channel: debugMetadata.feedbackChannel,
    },
    identity: {
      external: {
        id: debugMetadata.initiatedBy,
        platform: 'slack',
        displayName: 'Test User',
      },
    },
    egress: {
      destination: '',
      connector: 'slack',
      channel: debugMetadata.feedbackChannel,
    },
    message: {
      id: `msg-${correlationId}`,
      role: 'user',
      text: 'test message',
    },
    qos: {
      tracer: true,
    },
    metadata: {
      debug: debugMetadata,
    },
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    },
    ...overrides,
  } as InternalEventV2;
}

/**
 * Create a mock Slack message event with optional !debug prefix
 *
 * @param options - Configuration options
 * @returns Mock Slack event body
 *
 * @example
 * ```typescript
 * const debugMsg = createMockSlackMessage({ withDebugPrefix: true, text: 'test' });
 * expect(debugMsg.event.text).toBe('!debug test');
 *
 * const normalMsg = createMockSlackMessage({ withDebugPrefix: false, text: 'hello' });
 * expect(normalMsg.event.text).toBe('hello');
 * ```
 */
export function createMockSlackMessage(options: {
  withDebugPrefix?: boolean;
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
} = {}) {
  const {
    withDebugPrefix = false,
    text = 'test message',
    user = 'U0123456789',
    channel = 'C9876543210',
    ts = '1234567890.123456',
    thread_ts,
    team = 'T0987654321',
  } = options;

  const messageText = withDebugPrefix ? `!debug ${text}` : text;

  return {
    type: 'events_api',
    team_id: team,
    api_app_id: 'A0123456789',
    event: {
      type: 'message',
      user,
      channel,
      text: messageText,
      ts,
      thread_ts,
      team,
      event_ts: ts,
    },
  };
}

/**
 * Assert that an event has valid debug metadata
 *
 * @param event - Event to validate
 * @throws AssertionError if debug metadata is invalid or missing
 *
 * @example
 * ```typescript
 * const event = createDebugEvent();
 * assertDebugMetadata(event); // passes
 *
 * const normalEvent = { ...event, qos: { tracer: false } };
 * assertDebugMetadata(normalEvent); // throws
 * ```
 */
export function assertDebugMetadata(event: InternalEventV2): void {
  if (!event.qos?.tracer) {
    throw new Error('Event must have qos.tracer=true for debug mode');
  }

  if (!event.metadata?.debug) {
    throw new Error('Event must have metadata.debug for debug mode');
  }

  const debug = event.metadata.debug;

  if (!debug.enabled) {
    throw new Error('Debug metadata must have enabled=true');
  }

  if (!debug.initiatedBy || typeof debug.initiatedBy !== 'string') {
    throw new Error('Debug metadata must have initiatedBy (string)');
  }

  if (!debug.feedbackChannel || typeof debug.feedbackChannel !== 'string') {
    throw new Error('Debug metadata must have feedbackChannel (string)');
  }

  if (!debug.startedAt || typeof debug.startedAt !== 'string') {
    throw new Error('Debug metadata must have startedAt (ISO8601 string)');
  }

  // Validate ISO8601 format
  const timestamp = new Date(debug.startedAt);
  if (isNaN(timestamp.getTime())) {
    throw new Error(`Debug metadata startedAt must be valid ISO8601: ${debug.startedAt}`);
  }
}

/**
 * Create a minimal InternalEventV2 for non-debug testing
 *
 * @param overrides - Optional field overrides
 * @returns InternalEventV2 without debug metadata
 *
 * @example
 * ```typescript
 * const normalEvent = createNormalEvent();
 * expect(normalEvent.qos?.tracer).toBeUndefined();
 * expect(normalEvent.metadata?.debug).toBeUndefined();
 * ```
 */
export function createNormalEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  const correlationId = randomUUID();
  const now = new Date().toISOString();

  return {
    v: '2',
    correlationId,
    type: 'chat.message.v1',
    ingress: {
      ingressAt: now,
      source: 'ingress.slack',
      connector: 'slack',
      channel: 'C9876543210',
    },
    identity: {
      external: {
        id: 'U0123456789',
        platform: 'slack',
        displayName: 'Test User',
      },
    },
    egress: {
      destination: '',
      connector: 'slack',
      channel: 'C9876543210',
    },
    message: {
      id: `msg-${correlationId}`,
      role: 'user',
      text: 'normal message',
    },
    routing: {
      stage: 'initial',
      slip: [],
      history: [],
    },
    ...overrides,
  } as InternalEventV2;
}

/**
 * Create mock Slack WebClient for testing
 *
 * @param overrides - Optional method overrides
 * @returns Mock WebClient with jest.fn() methods
 *
 * @example
 * ```typescript
 * const mockWebClient = createMockWebClient();
 * await mockWebClient.chat.postMessage({ channel: 'C123', text: 'hello' });
 * expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
 *   channel: 'C123',
 *   text: 'hello'
 * });
 * ```
 */
export function createMockWebClient(overrides: Record<string, any> = {}) {
  return {
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
      postEphemeral: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides.chat,
    },
    auth: {
      test: jest.fn().mockResolvedValue({
        ok: true,
        user_id: 'U_BOT123',
        team_id: 'T0987654321',
        team: 'Test Team',
        user: 'TestBot',
      }),
      ...overrides.auth,
    },
  };
}
