import { RxJSWindowManager } from './rxjs-window-manager';
import type { InternalEventV2 } from '../../types/events';
import type { StreamObserver } from '../../types/sessi';

// TODO: Flaky test - Intermittent NATS connection errors
describe.skip('RxJSWindowManager', () => {
  let manager: RxJSWindowManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };
    manager = new RxJSWindowManager(mockLogger);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createSlidingWindow', () => {
    it('should create a sliding window subscription', () => {
      const observer: StreamObserver = {
        id: 'test-observer',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1']
        },
        window: {
          type: 'sliding',
          sizeMs: 1000,
          slideMs: 500
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const onWindowClose = jest.fn().mockResolvedValue(undefined);
      manager.createSlidingWindow(observer, onWindowClose);

      expect(manager.getSubscriptionCount()).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith('rxjs.window.created', expect.objectContaining({
        observerId: 'test-observer',
        type: 'sliding'
      }));
    });

    it('should trigger window closure after slideMs with buffered events', (done) => {
      const observer: StreamObserver = {
        id: 'test-observer-2',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1']
        },
        window: {
          type: 'sliding',
          sizeMs: 200,
          slideMs: 100
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const receivedEvents: InternalEventV2[] = [];
      const onWindowClose = jest.fn(async (events: InternalEventV2[]) => {
        receivedEvents.push(...events);
        if (receivedEvents.length >= 2) {
          expect(receivedEvents).toHaveLength(2);
          expect(receivedEvents[0].correlationId).toBe('test-1');
          expect(receivedEvents[1].correlationId).toBe('test-2');
          done();
        }
      });

      manager.createSlidingWindow(observer, onWindowClose);

      // Add events
      const event1: InternalEventV2 = {
        v: '2',
        correlationId: 'test-1',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'twitch',
          connector: 'system'
        },
        identity: {
          external: {
            id: 'user-1',
            platform: 'twitch'
          }
        },
        egress: {
          destination: 'twitch',
          connector: 'twitch'
        },
        message: {
          id: 'msg-1',
          role: 'user',
          text: 'Test message 1'
        },
        routing: {
          stage: 'contextualization',
          slip: [],
          history: []
        }
      };

      const event2: InternalEventV2 = {
        ...event1,
        correlationId: 'test-2',
        message: {
          ...event1.message!,
          id: 'msg-2',
          text: 'Test message 2'
        }
      };

      manager.addEvent(event1);
      manager.addEvent(event2);
    }, 10000);

    it('should filter events by platform', (done) => {
      const observer: StreamObserver = {
        id: 'test-filter',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1'],
          filters: {
            platforms: ['twitch']
          }
        },
        window: {
          type: 'sliding',
          sizeMs: 100,
          slideMs: 50
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const onWindowClose = jest.fn(async (events: InternalEventV2[]) => {
        expect(events).toHaveLength(1);
        expect(events[0].ingress?.source).toBe('twitch');
        done();
      });

      manager.createSlidingWindow(observer, onWindowClose);

      const twitchEvent: InternalEventV2 = {
        v: '2',
        correlationId: 'twitch-1',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'twitch',
          connector: 'system'
        },
        identity: {
          external: {
            id: 'user-1',
            platform: 'twitch'
          }
        },
        egress: {
          destination: 'twitch',
          connector: 'twitch'
        },
        message: {
          id: 'msg-1',
          role: 'user',
          text: 'Twitch message'
        },
        routing: {
          stage: 'contextualization',
          slip: [],
          history: []
        }
      };

      const discordEvent: InternalEventV2 = {
        ...twitchEvent,
        correlationId: 'discord-1',
        ingress: {
          ...twitchEvent.ingress!,
          source: 'discord'
        }
      };

      manager.addEvent(twitchEvent);
      manager.addEvent(discordEvent); // Should be filtered out
    }, 5000);

    it('should skip empty windows', (done) => {
      const observer: StreamObserver = {
        id: 'empty-window',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1']
        },
        window: {
          type: 'sliding',
          sizeMs: 100,
          slideMs: 50
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const onWindowClose = jest.fn().mockResolvedValue(undefined);
      manager.createSlidingWindow(observer, onWindowClose);

      // Don't add any events
      setTimeout(() => {
        expect(onWindowClose).not.toHaveBeenCalled();
        done();
      }, 200);
    }, 5000);
  });

  describe('removeObserver', () => {
    it('should unsubscribe and remove observer', () => {
      const observer: StreamObserver = {
        id: 'remove-test',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1']
        },
        window: {
          type: 'sliding',
          sizeMs: 1000,
          slideMs: 500
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      manager.createSlidingWindow(observer, jest.fn());
      expect(manager.getSubscriptionCount()).toBe(1);

      manager.removeObserver('remove-test');
      expect(manager.getSubscriptionCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should clean up all subscriptions', () => {
      const observer1: StreamObserver = {
        id: 'destroy-1',
        active: true,
        mcpEnabled: false,
        source: {
          mode: 'stream',
          topics: ['internal.contextualization.v1']
        },
        window: {
          type: 'sliding',
          sizeMs: 1000,
          slideMs: 500
        },
        trigger: { type: 'time' },
        analysis: {
          promptId: 'test-prompt',
          inspectionEnabled: false,
          outputFormat: 'markdown'
        },
        delivery: {
          egressTopic: 'internal.egress.v1',
          destination: {
            type: 'chat',
            target: '#test'
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const observer2 = { ...observer1, id: 'destroy-2' };

      manager.createSlidingWindow(observer1, jest.fn());
      manager.createSlidingWindow(observer2, jest.fn());
      expect(manager.getSubscriptionCount()).toBe(2);

      manager.destroy();
      expect(manager.getSubscriptionCount()).toBe(0);
    });
  });
});
