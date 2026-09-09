/**
 * Security Tests for IngressManager - Sprint 39
 *
 * Critical security validation for event.inject.v2 permission-gated event injection.
 * Tests verify permission enforcement, audit logging, and protection against malicious inputs.
 *
 * Security model:
 * - event.inject.v2 requires 'event:inject' permission
 * - Anonymous users always rejected
 * - Dev tokens (brat-dev-mcp:*, dev-tools:*) auto-granted
 * - Audit logging captures both real and emulated identity
 * - Connector validation prevents forgery
 * - Routing slip always initialized (prevents manipulation)
 */

import { IngressManager } from '../ingress';
import { Logger } from '../../../common/logging';
import { InternalEventV2 } from '../../../types/events';

describe('IngressManager Security (event.inject.v2)', () => {
  let mockPublisher: any;
  let mockPublishers: any;
  let mockLogger: Logger;

  beforeEach(() => {
    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
    };
    mockPublishers = {
      create: jest.fn().mockReturnValue(mockPublisher)
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    } as any;
  });

  describe('Permission Enforcement', () => {
    it('should reject anonymous users attempting event injection', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await expect(
        manager.handleMessage('anonymous', frame, ['event:inject'])
      ).rejects.toThrow('event.inject.v2 is not available for anonymous connections');

      // Verify audit log
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ingress.event_inject_denied',
        expect.objectContaining({
          userId: 'anonymous',
          reason: 'anonymous_user'
        })
      );
    });

    it('should reject users without event:inject permission', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await expect(
        manager.handleMessage('regular-user', frame, ['user:read'])
      ).rejects.toThrow('event.inject.v2 requires "event:inject" permission');

      // Verify audit log
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ingress.event_inject_denied',
        expect.objectContaining({
          userId: 'regular-user',
          reason: 'missing_permission',
          requiredPermission: 'event:inject',
          userPermissions: ['user:read']
        })
      );
    });

    it('should reject users with empty permissions array', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await expect(
        manager.handleMessage('user-no-perms', frame, [])
      ).rejects.toThrow('event.inject.v2 requires "event:inject" permission');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ingress.event_inject_denied',
        expect.objectContaining({
          userId: 'user-no-perms',
          userPermissions: []
        })
      );
    });

    it('should accept users with event:inject permission', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'authorized test' },
            ingress: { connector: 'api', source: 'test' }
          }
        }
      });

      await expect(
        manager.handleMessage('authorized-user', frame, ['event:inject'])
      ).resolves.not.toThrow();

      // Verify event published
      expect(mockPublisher.publishJson).toHaveBeenCalled();

      // Verify audit log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ingress.event_inject',
        expect.objectContaining({
          realUserId: 'authorized-user',
          permissions: ['event:inject']
        })
      );
    });
  });

  describe('Connector Validation', () => {
    it('should reject invalid connector values', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' },
            ingress: { connector: 'malicious-connector', source: 'test' }
          }
        }
      });

      await expect(
        manager.handleMessage('test-user', frame, ['event:inject'])
      ).rejects.toThrow('Invalid connector: "malicious-connector"');

      // Verify audit log
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ingress.event_inject_denied',
        expect.objectContaining({
          userId: 'test-user',
          reason: 'invalid_connector',
          providedConnector: 'malicious-connector',
          allowedConnectors: ['api', 'discord', 'twitch', 'twilio', 'slack']
        })
      );
    });

    it('should accept all valid connector values', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);
      const validConnectors = ['api', 'discord', 'twitch', 'twilio', 'slack'];

      for (const connector of validConnectors) {
        const frame = JSON.stringify({
          type: 'event.inject.v2',
          payload: {
            event: {
              type: 'chat.message.v1',
              message: { id: '1', role: 'user', text: 'test' },
              ingress: { connector, source: 'test' }
            }
          }
        });

        await expect(
          manager.handleMessage('test-user', frame, ['event:inject'])
        ).resolves.not.toThrow();
      }

      // Each event publishes twice: ingress + snapshot
      expect(mockPublisher.publishJson).toHaveBeenCalledTimes(validConnectors.length * 2);
    });

    it('should default to api connector if not provided', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          ingress: expect.objectContaining({
            connector: 'api'
          })
        }),
        expect.anything()
      );
    });
  });

  describe('Audit Logging', () => {
    it('should log dual identity (real + emulated)', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' },
            identity: {
              external: {
                id: 'emulated-user-123',
                platform: 'discord'
              }
            },
            ingress: { connector: 'discord', source: 'ingress.discord' }
          }
        }
      });

      await manager.handleMessage('real-user', frame, ['event:inject']);

      // Verify audit log captures both identities
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ingress.event_inject',
        expect.objectContaining({
          realUserId: 'real-user',
          emulatedIdentity: 'emulated-user-123',
          emulatedPlatform: 'discord',
          emulatedConnector: 'discord',
          permissions: ['event:inject']
        })
      );
    });

    it('should log successful event injection with metadata', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' },
            ingress: { connector: 'twitch', source: 'ingress.twitch' }
          }
        },
        metadata: { id: 'correlation-123' }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'ingress.event_inject.published',
        expect.objectContaining({
          userId: 'test-user',
          type: 'chat.message.v1',
          correlationId: 'correlation-123',
          connector: 'twitch'
        })
      );
    });
  });

  describe('Routing Slip Security', () => {
    it('should always initialize routing slip to prevent manipulation', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      // Attempt to inject malicious routing slip
      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' },
            routing: {
              slip: ['malicious-service-1', 'malicious-service-2'],
              stage: 'reaction',
              history: ['bypass-auth']
            }
          }
        }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      // Verify routing slip was overwritten with safe defaults
      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          routing: {
            stage: 'initial',
            slip: [],
            history: []
          }
        }),
        expect.anything()
      );
    });
  });

  describe('Payload Validation', () => {
    it('should reject event.inject.v2 without payload.event', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          // Missing event field
          text: 'invalid'
        }
      });

      await expect(
        manager.handleMessage('test-user', frame, ['event:inject'])
      ).rejects.toThrow('payload.event is required');
    });

    it('should preserve all event fields from payload', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const customEvent = {
        type: 'custom.event.v1',
        message: { id: 'msg-1', role: 'user' as const, text: 'custom message' },
        payload: { customField: 'custom value' },
        annotations: [{ kind: 'test', value: 'annotation' }],
        candidates: [{ text: 'candidate 1' }],
        ingress: { connector: 'slack' as const, source: 'ingress.slack' },
        identity: {
          external: {
            id: 'slack-user-123',
            platform: 'slack',
            displayName: 'Test User'
          }
        },
        egress: {
          destination: 'slack-channel-123',
          type: 'chat' as const,
          connector: 'slack' as const
        }
      };

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: { event: customEvent }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'custom.event.v1',
          message: customEvent.message,
          payload: customEvent.payload,
          annotations: customEvent.annotations,
          candidates: customEvent.candidates,
          ingress: expect.objectContaining({
            connector: 'slack',
            source: 'ingress.slack'
          }),
          identity: customEvent.identity,
          egress: customEvent.egress
        }),
        expect.anything()
      );
    });
  });

  describe('Backward Compatibility', () => {
    it('should still handle chat.message.v1 normally', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'chat.message.v1',
        payload: { text: 'regular chat message' }
      });

      // No permissions required for regular chat
      await expect(
        manager.handleMessage('regular-user', frame, [])
      ).resolves.not.toThrow();

      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat.message.v1',
          message: expect.objectContaining({
            text: 'regular chat message'
          })
        }),
        expect.anything()
      );

      // Should NOT log event_inject (different flow)
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'ingress.event_inject',
        expect.anything()
      );
    });

    it('should handle chat.message.send normally', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'chat.message.send',
        payload: { text: 'send message' }
      });

      await expect(
        manager.handleMessage('regular-user', frame, [])
      ).resolves.not.toThrow();

      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat.message.v1',
          message: expect.objectContaining({
            text: 'send message'
          })
        }),
        expect.anything()
      );
    });
  });

  describe('Default Value Merging', () => {
    it('should merge partial event with defaults', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            // Minimal event
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      const publishedEvent = mockPublisher.publishJson.mock.calls[0][0] as InternalEventV2;

      // Verify defaults applied
      expect(publishedEvent).toMatchObject({
        v: '2',
        type: 'chat.message.v1',
        correlationId: expect.any(String),
        traceId: expect.any(String),
        ingress: {
          ingressAt: expect.any(String),
          source: 'api-gateway',
          connector: 'api'
        },
        identity: {
          external: {
            id: 'test-user',
            platform: 'api-gateway'
          }
        },
        egress: {
          destination: 'api-gateway',
          type: 'chat',
          connector: 'api'
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: []
        }
      });
    });

    it('should preserve provided correlationId', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            correlationId: 'custom-correlation-id',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      expect(mockPublisher.publishJson).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'custom-correlation-id'
        }),
        expect.anything()
      );
    });
  });

  describe('Snapshot Publishing', () => {
    it('should publish initial snapshot after event injection', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      await manager.handleMessage('test-user', frame, ['event:inject']);

      // Should publish twice: once for ingress, once for snapshot
      expect(mockPublisher.publishJson).toHaveBeenCalledTimes(2);

      // Verify snapshot log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'persistence.snapshot.published',
        expect.anything()
      );
    });

    it('should fail-open if snapshot publishing fails', async () => {
      const manager = new IngressManager(mockPublishers, mockLogger);

      // Mock snapshot publishing failure (second call)
      mockPublisher.publishJson
        .mockResolvedValueOnce({ messageId: '123' })  // ingress succeeds
        .mockRejectedValueOnce(new Error('Snapshot failed'));  // snapshot fails

      const frame = JSON.stringify({
        type: 'event.inject.v2',
        payload: {
          event: {
            type: 'chat.message.v1',
            message: { id: '1', role: 'user', text: 'test' }
          }
        }
      });

      // Should not throw despite snapshot failure
      await expect(
        manager.handleMessage('test-user', frame, ['event:inject'])
      ).resolves.not.toThrow();

      // Verify warning logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ingress.event_inject.snapshot.publish_error',
        expect.objectContaining({
          error: 'Snapshot failed'
        })
      );
    });
  });
});
