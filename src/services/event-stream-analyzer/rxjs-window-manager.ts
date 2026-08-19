import { Subject, Subscription, interval } from 'rxjs';
import { bufferTime, filter, buffer, debounceTime, scan, tap } from 'rxjs/operators';
import type { InternalEventV2 } from '../../types/events';
import type { StreamObserver } from '../../types/sessi';
import type { WindowState } from './snapshot-manager';

/**
 * Window state tracking for snapshot/restore
 * Tracks events currently in each window for crash recovery
 */
interface WindowStateTracking {
  observerId: string;
  eventIds: string[];
  windowStartedAt: string;
  lastEventAt: string;
}

export class RxJSWindowManager {
  private eventSubject = new Subject<InternalEventV2>();
  private subscriptions = new Map<string, Subscription>();
  private windowStates = new Map<string, WindowStateTracking>();
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Create a sliding window observer using RxJS bufferTime
   */
  createSlidingWindow(
    observer: StreamObserver,
    onWindowClose: (events: InternalEventV2[], observerId: string) => Promise<void>
  ): void {
    const windowSizeMs = observer.window?.sizeMs || 300000; // Default 5 min
    const slideMs = observer.window?.slideMs || 60000; // Default 1 min

    const subscription = this.eventSubject.pipe(
      // Filter events matching this observer
      filter(event => this.matchesObserver(event, observer)),

      // Track events entering window
      tap(event => this.trackEventAdded(observer.id, event)),

      // Buffer events in sliding window
      bufferTime(windowSizeMs, slideMs),

      // Skip empty windows
      filter(events => events.length > 0)
    ).subscribe({
      next: async (events) => {
        this.logger.info('rxjs.window.closed', {
          observerId: observer.id,
          eventCount: events.length,
          windowSizeMs,
          slideMs
        });

        try {
          await onWindowClose(events, observer.id);
          // Clear window state after successful processing
          this.trackWindowClosed(observer.id);
        } catch (error: any) {
          this.logger.error('rxjs.window.callback_error', {
            observerId: observer.id,
            error: error.message
          });
        }
      },
      error: (err) => {
        this.logger.error('rxjs.window.error', {
          observerId: observer.id,
          error: err.message
        });
      }
    });

    this.subscriptions.set(observer.id, subscription);

    this.logger.info('rxjs.window.created', {
      observerId: observer.id,
      type: 'sliding',
      windowSizeMs,
      slideMs
    });
  }

  /**
   * Create a tumbling window observer using RxJS buffer + interval
   * Tumbling windows are non-overlapping, fixed-size intervals
   */
  createTumblingWindow(
    observer: StreamObserver,
    onWindowClose: (events: InternalEventV2[], observerId: string) => Promise<void>
  ): void {
    const windowSizeMs = observer.window?.sizeMs || 300000; // Default 5 min

    // Create interval trigger for window closes
    const trigger = interval(windowSizeMs);

    const subscription = this.eventSubject.pipe(
      // Filter events matching this observer
      filter(event => this.matchesObserver(event, observer)),

      // Track events entering window
      tap(event => this.trackEventAdded(observer.id, event)),

      // Buffer events until trigger emits
      buffer(trigger),

      // Skip empty windows
      filter(events => events.length > 0)
    ).subscribe({
      next: async (events) => {
        this.logger.info('rxjs.window.closed', {
          observerId: observer.id,
          eventCount: events.length,
          windowType: 'tumbling',
          windowSizeMs
        });

        try {
          await onWindowClose(events, observer.id);
          // Clear window state after successful processing
          this.trackWindowClosed(observer.id);
        } catch (error: any) {
          this.logger.error('rxjs.window.callback_error', {
            observerId: observer.id,
            error: error.message
          });
        }
      },
      error: (err) => {
        this.logger.error('rxjs.window.error', {
          observerId: observer.id,
          error: err.message
        });
      }
    });

    this.subscriptions.set(observer.id, subscription);

    this.logger.info('rxjs.window.created', {
      observerId: observer.id,
      type: 'tumbling',
      windowSizeMs
    });
  }

  /**
   * Create a session window observer using RxJS debounceTime + scan
   * Session windows close after a period of inactivity (no events)
   */
  createSessionWindow(
    observer: StreamObserver,
    onWindowClose: (events: InternalEventV2[], observerId: string) => Promise<void>
  ): void {
    const sessionGapMs = observer.window?.sessionGapMs || 60000; // Default 1 min inactivity

    let currentBuffer: InternalEventV2[] = [];

    const subscription = this.eventSubject.pipe(
      // Filter events matching this observer
      filter(event => this.matchesObserver(event, observer)),

      // Track events entering window
      tap(event => this.trackEventAdded(observer.id, event)),

      // Accumulate events in buffer
      scan((buffer, event) => {
        buffer.push(event);
        return buffer;
      }, currentBuffer),

      // Wait for inactivity gap before emitting
      debounceTime(sessionGapMs)
    ).subscribe({
      next: async (events) => {
        if (events.length === 0) return;

        this.logger.info('rxjs.window.closed', {
          observerId: observer.id,
          eventCount: events.length,
          windowType: 'session',
          sessionGapMs
        });

        try {
          await onWindowClose([...events], observer.id);

          // Clear buffer after processing
          currentBuffer = [];
          // Clear window state after successful processing
          this.trackWindowClosed(observer.id);
        } catch (error: any) {
          this.logger.error('rxjs.window.callback_error', {
            observerId: observer.id,
            error: error.message
          });
        }
      },
      error: (err) => {
        this.logger.error('rxjs.window.error', {
          observerId: observer.id,
          error: err.message
        });
      }
    });

    this.subscriptions.set(observer.id, subscription);

    this.logger.info('rxjs.window.created', {
      observerId: observer.id,
      type: 'session',
      sessionGapMs
    });
  }

  /**
   * Create window based on observer configuration
   * Factory method that delegates to the appropriate window type method
   */
  createWindow(
    observer: StreamObserver,
    onWindowClose: (events: InternalEventV2[], observerId: string) => Promise<void>
  ): void {
    const windowType = observer.window?.type || 'sliding';

    switch (windowType) {
      case 'sliding':
        this.createSlidingWindow(observer, onWindowClose);
        break;
      case 'tumbling':
        this.createTumblingWindow(observer, onWindowClose);
        break;
      case 'session':
        this.createSessionWindow(observer, onWindowClose);
        break;
      default:
        this.logger.error('rxjs.window.unknown_type', {
          observerId: observer.id,
          windowType
        });
        throw new Error(`Unknown window type: ${windowType}`);
    }
  }

  /**
   * Add event to stream (will be routed to matching windows)
   * Event tracking happens in window pipelines via tap() operator
   */
  addEvent(event: InternalEventV2): void {
    this.eventSubject.next(event);
  }

  /**
   * Match event against observer filters
   */
  private matchesObserver(event: InternalEventV2, observer: StreamObserver): boolean {
    const filters = observer.source?.filters;
    if (!filters) return true;

    // Platform filter (platform info is in ingress.source)
    if (filters.platforms?.length) {
      const platform = event.ingress?.source;
      if (!platform || !filters.platforms.includes(platform)) {
        return false;
      }
    }

    // Event type filter
    if (filters.eventTypes?.length) {
      if (!filters.eventTypes.includes(event.type)) {
        return false;
      }
    }

    // Channel filter (channel info is in ingress.channel)
    if (filters.channels?.length) {
      const channel = event.ingress?.channel;
      if (!channel || !filters.channels.includes(channel)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Remove observer (cleanup subscription)
   */
  removeObserver(observerId: string): void {
    const sub = this.subscriptions.get(observerId);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(observerId);
      this.logger.info('rxjs.window.removed', { observerId });
    }
  }

  /**
   * Get subscription count for monitoring
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Cleanup all subscriptions
   */
  destroy(): void {
    this.logger.info('rxjs.window.destroying_all', {
      subscriptionCount: this.subscriptions.size
    });

    for (const [observerId, sub] of this.subscriptions.entries()) {
      sub.unsubscribe();
      this.logger.debug('rxjs.window.destroyed', { observerId });
    }

    this.subscriptions.clear();
    this.windowStates.clear();
    this.eventSubject.complete();
  }

  /**
   * Track event addition to window state
   * Called when event matches an observer and enters its window
   */
  private trackEventAdded(observerId: string, event: InternalEventV2): void {
    let state = this.windowStates.get(observerId);

    if (!state) {
      // Initialize window state on first event
      state = {
        observerId,
        eventIds: [],
        windowStartedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString()
      };
      this.windowStates.set(observerId, state);
    }

    // Add event ID and update timestamp
    state.eventIds.push(event.correlationId);
    state.lastEventAt = new Date().toISOString();

    this.logger.debug('rxjs.window.event_tracked', {
      observerId,
      eventId: event.correlationId,
      totalEvents: state.eventIds.length
    });
  }

  /**
   * Track window close (reset state)
   * Called after onWindowClose callback completes successfully
   */
  private trackWindowClosed(observerId: string): void {
    this.windowStates.delete(observerId);
    this.logger.debug('rxjs.window.state_reset', { observerId });
  }

  /**
   * Get all current window states for snapshotting
   * Used by SnapshotManager to persist window state
   */
  getAllWindowStates(): Map<string, WindowState> {
    const states = new Map<string, WindowState>();

    for (const [observerId, tracking] of this.windowStates.entries()) {
      states.set(observerId, {
        observerId: tracking.observerId,
        eventIds: [...tracking.eventIds], // Clone array
        eventCount: tracking.eventIds.length,
        windowStartedAt: tracking.windowStartedAt,
        lastEventAt: tracking.lastEventAt,
        snapshotAt: new Date().toISOString()
      });
    }

    this.logger.debug('rxjs.window.states_collected', {
      windowCount: states.size,
      totalEvents: Array.from(states.values()).reduce((sum, s) => sum + s.eventCount, 0)
    });

    return states;
  }

  /**
   * Restore window states from snapshot
   * Used during service startup to recover from crash
   */
  restoreWindowStates(states: Map<string, WindowState>): void {
    for (const [observerId, snapshot] of states.entries()) {
      this.windowStates.set(observerId, {
        observerId: snapshot.observerId,
        eventIds: [...snapshot.eventIds], // Clone array
        windowStartedAt: snapshot.windowStartedAt,
        lastEventAt: snapshot.lastEventAt
      });

      this.logger.info('rxjs.window.state_restored', {
        observerId,
        eventCount: snapshot.eventIds.length,
        age: Date.now() - new Date(snapshot.snapshotAt).getTime()
      });
    }

    this.logger.info('rxjs.window.restore_complete', {
      windowCount: states.size,
      totalEvents: Array.from(states.values()).reduce((sum, s) => sum + s.eventCount, 0)
    });
  }
}
