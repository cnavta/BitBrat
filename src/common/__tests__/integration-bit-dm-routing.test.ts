/**
 * IntegrationBit DM Routing Tests
 *
 * Test suite for DM egress routing functionality in IntegrationBit.
 *
 * Sprint 13: DM Capability Implementation (DM-008)
 *
 * @since Sprint 13
 */

import { IntegrationBit, IntegrationBitConfig } from '../integration-bit';
import type { InternalEventV2 } from '../../types/events';
import type { IngressConnector, EgressConnector } from '../../services/ingress/core';

describe('IntegrationBit DM Routing', () => {
  let integrationBit: IntegrationBit;
  let mockConnectorWithDM: IngressConnector & EgressConnector;
  let mockConnectorWithoutDM: IngressConnector & EgressConnector;
  let mockPublisher: any;
  let mockDocumentStore: any;

  beforeEach(() => {
    // Mock connector WITH sendDM support
    mockConnectorWithDM = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
      sendText: jest.fn().mockResolvedValue(undefined),
      sendDM: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockReturnValue({
        platform: 'discord',
        version: '1.0.0',
        capabilities: {
          ingress: { method: 'websocket', realtime: true },
          egress: { chat: true, dm: true },
        },
      }),
    } as any;

    // Mock connector WITHOUT sendDM support
    mockConnectorWithoutDM = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn().mockReturnValue({ state: 'CONNECTED' }),
      sendText: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockReturnValue({
        platform: 'twitch',
        version: '1.0.0',
        capabilities: {
          ingress: { method: 'websocket', realtime: true },
          egress: { chat: true, dm: false },
        },
      }),
    } as any;

    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue(undefined),
    };

    mockDocumentStore = {
      collection: jest.fn(),
    };

    // Create IntegrationBit with mock connectors
    const config: IntegrationBitConfig = {
      serviceName: 'test-integration',
      connectors: [
        {
          name: 'discord',
          factory: async () => mockConnectorWithDM,
        },
        {
          name: 'twitch',
          factory: async () => mockConnectorWithoutDM,
        },
      ],
    };

    integrationBit = new IntegrationBit(config);

    // Mock resources
    (integrationBit as any).resources = {
      publisher: {
        create: jest.fn().mockReturnValue(mockPublisher),
      },
      documentStore: mockDocumentStore,
    };
  });

  afterEach(async () => {
    await integrationBit.close();
  });

  describe('DM egress routing', () => {
    it('should route DM to sendDM when connector supports it', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
          channel: 'dm-channel-123',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'discord',
            displayName: 'TestUser',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'discord',
        },
        candidates: [
          {
            id: 'candidate-1',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Hello from DM!',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // Access private processEgress method via (integrationBit as any)
      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).toHaveBeenCalledWith('Hello from DM!', 'user-123');
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });

    it('should fall back to sendText when connector does not support sendDM', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'twitch',
          channel: 'dm-channel-456',
        },
        identity: {
          external: {
            id: 'user-456',
            platform: 'twitch',
            displayName: 'TwitchUser',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'twitch',
          channel: 'dm-channel-456',
        },
        candidates: [
          {
            id: 'candidate-2',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Fallback to channel',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithoutDM.sendText).toHaveBeenCalledWith(
        'Fallback to channel',
        'dm-channel-456'
      );
    });

    it('should not route DM if userId is missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
        },
        identity: {
          external: {
            id: '', // Missing userId
            platform: 'discord',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'discord',
        },
        candidates: [
          {
            id: 'candidate-3',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Should not send',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });

    it('should not route DM if identity is completely missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
        },
        identity: {} as any, // Missing external identity
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'discord',
        },
        candidates: [
          {
            id: 'candidate-4',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Should not send',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });
  });

  describe('Chat egress routing (unchanged behavior)', () => {
    it('should route chat messages to sendText', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
          channel: 'general',
        },
        identity: {
          external: {
            id: 'user-789',
            platform: 'discord',
            displayName: 'ChatUser',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'chat',
          connector: 'discord',
          channel: 'general',
        },
        candidates: [
          {
            id: 'candidate-5',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Hello in channel!',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendText).toHaveBeenCalledWith('Hello in channel!', 'general');
      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
    });

    it('should route messages with no type to sendText', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
          channel: 'random',
        },
        identity: {
          external: {
            id: 'user-999',
            platform: 'discord',
            displayName: 'RandomUser',
          },
        },
        egress: {
          destination: 'test-destination',
          connector: 'discord',
          channel: 'random',
          // type is undefined
        },
        candidates: [
          {
            id: 'candidate-6',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Default to chat',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendText).toHaveBeenCalledWith('Default to chat', 'random');
      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
    });

    it('should use ingress channel when egress channel is missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
          channel: 'fallback-channel',
        },
        identity: {
          external: {
            id: 'user-111',
            platform: 'discord',
            displayName: 'FallbackUser',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'chat',
          connector: 'discord',
          // channel is undefined
        },
        candidates: [
          {
            id: 'candidate-7',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Use ingress channel',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendText).toHaveBeenCalledWith(
        'Use ingress channel',
        'fallback-channel'
      );
    });
  });

  describe('Error handling', () => {
    it('should not route if connector is missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'discord',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          // connector is undefined
        } as any,
        candidates: [
          {
            id: 'candidate-8',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Should not send',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });

    it('should not route if text is missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'discord',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'discord',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'discord',
        },
        candidates: [], // No candidates = no text
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });

    it('should not route if platform is unknown', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-source',
          connector: 'unknown' as any,
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'unknown',
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'dm',
          connector: 'unknown' as any,
        },
        candidates: [
          {
            id: 'candidate-9',
            kind: 'text',
            source: 'llm-bot',
            createdAt: new Date().toISOString(),
            status: 'proposed',
            priority: 0,
            text: 'Should not send',
          },
        ],
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      await (integrationBit as any).processEgress(event);

      expect(mockConnectorWithDM.sendDM).not.toHaveBeenCalled();
      expect(mockConnectorWithDM.sendText).not.toHaveBeenCalled();
    });
  });
});
