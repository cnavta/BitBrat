import { Subject, Subscription } from 'rxjs';
import { bufferTime, filter } from 'rxjs/operators';
import type { InternalEventV2 } from '../../types/events';
import type { StreamObserver } from '../../types/sessi';

export class RxJSWindowManager {
  private eventSubject = new Subject<InternalEventV2>();
  private subscriptions = new Map<string, Subscription>();
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
   * Add event to stream (will be routed to matching windows)
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
    this.eventSubject.complete();
  }
}
