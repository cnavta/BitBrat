import { logger as globalLogger } from '../../common/logging';

/**
 * MessageHandler type for NATS subscription callbacks
 */
export type MessageHandler = (data: any, attrs: any, ctx: any) => Promise<void>;

/**
 * SubscriptionManager
 *
 * Manages dynamic NATS topic subscriptions with reference counting.
 * Ensures subscriptions are added when the first observer for a topic is created,
 * and removed when the last observer for that topic is deleted.
 *
 * Phase 2: Multi-observer support with dynamic subscription management
 */
export class SubscriptionManager {
  private topicCounts = new Map<string, number>();
  private subscriptions = new Map<string, () => Promise<void>>();
  private logger: any;

  constructor(logger?: any) {
    this.logger = logger || globalLogger;
  }

  /**
   * Add a topic subscription (with reference counting)
   *
   * @param topic - NATS topic to subscribe to
   * @param subscribeCallback - Function to create the subscription (returns unsubscribe function)
   * @returns True if new subscription was created, false if already exists
   */
  async addTopic(
    topic: string,
    subscribeCallback: () => Promise<() => Promise<void>>
  ): Promise<boolean> {
    const currentCount = this.topicCounts.get(topic) || 0;
    const newCount = currentCount + 1;

    this.topicCounts.set(topic, newCount);

    this.logger.debug('subscription_manager.add_topic', {
      topic,
      refCount: newCount,
      isNewSubscription: currentCount === 0
    });

    // If this is the first observer for this topic, create subscription
    if (currentCount === 0) {
      this.logger.info('subscription_manager.add_topic.creating_subscription', {
        topic,
        refCount: newCount
      });

      try {
        const unsubscribe = await subscribeCallback();
        this.subscriptions.set(topic, unsubscribe);

        this.logger.info('subscription_manager.add_topic.subscription_created', {
          topic,
          refCount: newCount
        });

        return true; // New subscription created
      } catch (error: any) {
        this.logger.error('subscription_manager.add_topic.subscription_failed', {
          topic,
          error: error.message,
          stack: error.stack
        });

        // Rollback reference count on failure
        if (currentCount === 0) {
          this.topicCounts.delete(topic);
        } else {
          this.topicCounts.set(topic, currentCount);
        }
        throw error;
      }
    }

    return false; // Subscription already exists
  }

  /**
   * Remove a topic subscription (with reference counting)
   *
   * @param topic - NATS topic to unsubscribe from
   * @returns True if subscription was removed, false if still has references
   */
  async removeTopic(topic: string): Promise<boolean> {
    const currentCount = this.topicCounts.get(topic) || 0;

    if (currentCount === 0) {
      this.logger.warn('subscription_manager.remove_topic.not_found', { topic });
      return false;
    }

    const newCount = currentCount - 1;

    if (newCount === 0) {
      // Last observer for this topic - remove subscription
      this.topicCounts.delete(topic);

      const unsubscribe = this.subscriptions.get(topic);
      if (unsubscribe) {
        this.logger.info('subscription_manager.remove_topic.removing_subscription', {
          topic
        });

        try {
          await unsubscribe();
          this.subscriptions.delete(topic);

          this.logger.info('subscription_manager.remove_topic.subscription_removed', {
            topic
          });

          return true; // Subscription removed
        } catch (error: any) {
          this.logger.error('subscription_manager.remove_topic.unsubscribe_failed', {
            topic,
            error: error.message
          });

          // Keep subscription in map despite failure
          // (better to leak a subscription than to lose events)
          throw error;
        }
      } else {
        this.logger.warn('subscription_manager.remove_topic.no_unsubscribe_function', {
          topic
        });
      }
    } else {
      // Still have other observers for this topic
      this.topicCounts.set(topic, newCount);

      this.logger.debug('subscription_manager.remove_topic.ref_count_decremented', {
        topic,
        refCount: newCount
      });
    }

    return false; // Subscription still has references
  }

  /**
   * Get all active topics
   *
   * @returns Array of active topic names
   */
  getActiveTopics(): string[] {
    return Array.from(this.topicCounts.keys());
  }

  /**
   * Get reference count for a topic
   *
   * @param topic - Topic name
   * @returns Reference count (0 if topic not found)
   */
  getTopicRefCount(topic: string): number {
    return this.topicCounts.get(topic) || 0;
  }

  /**
   * Get total number of active subscriptions
   *
   * @returns Count of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get subscription statistics
   *
   * @returns Statistics object
   */
  getStats(): {
    activeTopics: number;
    activeSubscriptions: number;
    topicDetails: Array<{ topic: string; refCount: number }>;
  } {
    return {
      activeTopics: this.topicCounts.size,
      activeSubscriptions: this.subscriptions.size,
      topicDetails: Array.from(this.topicCounts.entries()).map(([topic, refCount]) => ({
        topic,
        refCount
      }))
    };
  }

  /**
   * Cleanup all subscriptions (for graceful shutdown)
   */
  async destroy(): Promise<void> {
    this.logger.info('subscription_manager.destroy.start', {
      subscriptionCount: this.subscriptions.size
    });

    const unsubscribePromises: Promise<void>[] = [];

    for (const [topic, unsubscribe] of this.subscriptions.entries()) {
      this.logger.debug('subscription_manager.destroy.unsubscribing', { topic });

      unsubscribePromises.push(
        unsubscribe().catch((error: any) => {
          this.logger.error('subscription_manager.destroy.unsubscribe_failed', {
            topic,
            error: error.message
          });
        })
      );
    }

    await Promise.all(unsubscribePromises);

    this.subscriptions.clear();
    this.topicCounts.clear();

    this.logger.info('subscription_manager.destroy.complete');
  }
}
