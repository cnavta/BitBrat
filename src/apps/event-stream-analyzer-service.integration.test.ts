/**
 * Integration test for Event Stream Analyzer
 * Tests windowing logic and event processing without external dependencies
 */
import { RxJSWindowManager } from '../services/event-stream-analyzer/rxjs-window-manager';
import type { InternalEventV2 } from '../types/events';
import type { StreamObserver } from '../types/sessi';

describe('Event Stream Analyzer Integration', () => {
  let windowManager: RxJSWindowManager;
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  };

  beforeEach(() => {
    windowManager = new RxJSWindowManager(mockLogger);
  });

  afterEach(() => {
    windowManager.destroy();
  });

  it('should process events through sliding window', async () => {
    const receivedWindows: InternalEventV2[][] = [];

    const observer: StreamObserver = {
      id: 'integration-test-1',
      active: true,
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
        promptId: 'test',
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    windowManager.createSlidingWindow(observer, async (events) => {
      receivedWindows.push(events);
    });

    // Create test events
    const createEvent = (id: string, text: string): InternalEventV2 => ({
      v: '2',
      correlationId: id,
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'twitch',
        connector: 'twitch'
      },
      identity: {
        external: { id: 'user-1', platform: 'twitch' }
      },
      egress: {
        destination: 'twitch',
        connector: 'twitch'
      },
      message: {
        id,
        role: 'user',
        text
      },
      routing: {
        stage: 'contextualization',
        slip: [],
        history: []
      }
    });

    windowManager.addEvent(createEvent('evt-1', 'First message'));
    windowManager.addEvent(createEvent('evt-2', 'Second message'));

    // Wait for window to close
    await new Promise(resolve => setTimeout(resolve, 250));

    // Should have received at least one window with events
    expect(receivedWindows.length).toBeGreaterThan(0);
    expect(receivedWindows[0].length).toBeGreaterThan(0);
  }, 10000);

  it('should filter events by platform', async () => {
    const receivedWindows: InternalEventV2[][] = [];

    const observer: StreamObserver = {
      id: 'filter-test',
      active: true,
      source: {
        mode: 'stream',
        topics: ['internal.contextualization.v1'],
        filters: {
          platforms: ['discord']
        }
      },
      window: {
        type: 'sliding',
        sizeMs: 200,
        slideMs: 100
      },
      trigger: { type: 'time' },
      analysis: {
        promptId: 'test',
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    windowManager.createSlidingWindow(observer, async (events) => {
      receivedWindows.push(events);
      // All events should be from discord
      events.forEach(e => {
        expect(e.ingress?.source).toBe('discord');
      });
    });

    // Add mixed platform events
    const twitchEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'twitch-evt',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'twitch',
        connector: 'twitch'
      },
      identity: {
        external: { id: 'user-1', platform: 'twitch' }
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
      correlationId: 'discord-evt',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'discord',
        connector: 'discord'
      },
      message: {
        id: 'msg-2',
        role: 'user',
        text: 'Discord message'
      }
    };

    windowManager.addEvent(twitchEvent);  // Should be filtered out
    windowManager.addEvent(discordEvent); // Should pass

    await new Promise(resolve => setTimeout(resolve, 250));

    // Verify filter worked
    if (receivedWindows.length > 0) {
      const allEvents = receivedWindows.flat();
      expect(allEvents.every(e => e.ingress?.source === 'discord')).toBe(true);
    }
  }, 10000);

  it('should handle multiple observers independently', async () => {
    const observer1Windows: InternalEventV2[][] = [];
    const observer2Windows: InternalEventV2[][] = [];

    const observer1: StreamObserver = {
      id: 'multi-observer-1',
      active: true,
      source: {
        mode: 'stream',
        filters: { platforms: ['twitch'] }
      },
      window: {
        type: 'sliding',
        sizeMs: 200,
        slideMs: 100
      },
      trigger: { type: 'time' },
      analysis: {
        promptId: 'test',
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const observer2: StreamObserver = {
      ...observer1,
      id: 'multi-observer-2',
      source: {
        mode: 'stream',
        filters: { platforms: ['discord'] }
      }
    };

    windowManager.createSlidingWindow(observer1, async (events) => {
      observer1Windows.push(events);
    });

    windowManager.createSlidingWindow(observer2, async (events) => {
      observer2Windows.push(events);
    });

    expect(windowManager.getSubscriptionCount()).toBe(2);

    // Add events for both platforms
    const createEvent = (platform: 'twitch' | 'discord'): InternalEventV2 => ({
      v: '2',
      correlationId: `${platform}-evt`,
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: platform,
        connector: platform
      },
      identity: {
        external: { id: 'user-1', platform }
      },
      egress: {
        destination: platform,
        connector: platform
      },
      message: {
        id: 'msg-1',
        role: 'user',
        text: `${platform} message`
      },
      routing: {
        stage: 'contextualization',
        slip: [],
        history: []
      }
    });

    windowManager.addEvent(createEvent('twitch'));
    windowManager.addEvent(createEvent('discord'));

    await new Promise(resolve => setTimeout(resolve, 250));

    // Each observer should have received only their filtered events
    if (observer1Windows.length > 0) {
      expect(observer1Windows.flat().every(e => e.ingress?.source === 'twitch')).toBe(true);
    }

    if (observer2Windows.length > 0) {
      expect(observer2Windows.flat().every(e => e.ingress?.source === 'discord')).toBe(true);
    }
  }, 10000);

  it('should cleanup observers correctly', () => {
    const observer: StreamObserver = {
      id: 'cleanup-test',
      active: true,
      source: { mode: 'stream' },
      window: {
        type: 'sliding',
        sizeMs: 1000,
        slideMs: 500
      },
      trigger: { type: 'time' },
      analysis: {
        promptId: 'test',
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    windowManager.createSlidingWindow(observer, jest.fn().mockResolvedValue(undefined));
    expect(windowManager.getSubscriptionCount()).toBe(1);

    windowManager.removeObserver(observer.id);
    expect(windowManager.getSubscriptionCount()).toBe(0);
  });
});
