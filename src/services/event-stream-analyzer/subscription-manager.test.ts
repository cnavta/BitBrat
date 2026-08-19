import { SubscriptionManager } from './subscription-manager';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;
  let unsubscribeMock: jest.Mock;
  let subscribeCallbackMock: jest.Mock;

  beforeEach(() => {
    manager = new SubscriptionManager(mockLogger);
    unsubscribeMock = jest.fn().mockResolvedValue(undefined);
    subscribeCallbackMock = jest.fn().mockResolvedValue(unsubscribeMock);
    jest.clearAllMocks();
  });

  describe('addTopic', () => {
    it('should create subscription for first observer', async () => {
      const result = await manager.addTopic('topic-1', subscribeCallbackMock);

      expect(result).toBe(true); // New subscription created
      expect(subscribeCallbackMock).toHaveBeenCalledTimes(1);
      expect(manager.getTopicRefCount('topic-1')).toBe(1);
      expect(manager.getActiveTopics()).toContain('topic-1');
      expect(manager.getSubscriptionCount()).toBe(1);
    });

    it('should increment ref count for additional observers (same topic)', async () => {
      // First observer
      await manager.addTopic('topic-1', subscribeCallbackMock);
      subscribeCallbackMock.mockClear();

      // Second observer (same topic)
      const result = await manager.addTopic('topic-1', subscribeCallbackMock);

      expect(result).toBe(false); // Subscription already exists
      expect(subscribeCallbackMock).not.toHaveBeenCalled(); // No new subscription
      expect(manager.getTopicRefCount('topic-1')).toBe(2);
      expect(manager.getSubscriptionCount()).toBe(1); // Still only 1 subscription
    });

    it('should create separate subscriptions for different topics', async () => {
      const unsubscribe1 = jest.fn().mockResolvedValue(undefined);
      const unsubscribe2 = jest.fn().mockResolvedValue(undefined);
      const subscribe1 = jest.fn().mockResolvedValue(unsubscribe1);
      const subscribe2 = jest.fn().mockResolvedValue(unsubscribe2);

      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-2', subscribe2);

      expect(subscribe1).toHaveBeenCalledTimes(1);
      expect(subscribe2).toHaveBeenCalledTimes(1);
      expect(manager.getTopicRefCount('topic-1')).toBe(1);
      expect(manager.getTopicRefCount('topic-2')).toBe(1);
      expect(manager.getSubscriptionCount()).toBe(2);
    });

    it('should rollback ref count on subscription failure', async () => {
      const failingSubscribe = jest.fn().mockRejectedValue(new Error('Subscription failed'));

      await expect(manager.addTopic('topic-fail', failingSubscribe)).rejects.toThrow('Subscription failed');

      expect(manager.getTopicRefCount('topic-fail')).toBe(0);
      expect(manager.getActiveTopics()).not.toContain('topic-fail');
    });

    it('should handle multiple topics with different ref counts', async () => {
      const subscribe1 = jest.fn().mockResolvedValue(jest.fn());
      const subscribe2 = jest.fn().mockResolvedValue(jest.fn());
      const subscribe3 = jest.fn().mockResolvedValue(jest.fn());

      // topic-1: 3 observers
      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-1', subscribe1);

      // topic-2: 1 observer
      await manager.addTopic('topic-2', subscribe2);

      // topic-3: 2 observers
      await manager.addTopic('topic-3', subscribe3);
      await manager.addTopic('topic-3', subscribe3);

      expect(manager.getTopicRefCount('topic-1')).toBe(3);
      expect(manager.getTopicRefCount('topic-2')).toBe(1);
      expect(manager.getTopicRefCount('topic-3')).toBe(2);
      expect(manager.getSubscriptionCount()).toBe(3);
    });
  });

  describe('removeTopic', () => {
    it('should decrement ref count without removing subscription', async () => {
      // Add 2 observers for same topic
      await manager.addTopic('topic-1', subscribeCallbackMock);
      await manager.addTopic('topic-1', subscribeCallbackMock);

      const result = await manager.removeTopic('topic-1');

      expect(result).toBe(false); // Subscription not removed (still has refs)
      expect(unsubscribeMock).not.toHaveBeenCalled();
      expect(manager.getTopicRefCount('topic-1')).toBe(1);
      expect(manager.getSubscriptionCount()).toBe(1);
    });

    it('should remove subscription when last observer is removed', async () => {
      await manager.addTopic('topic-1', subscribeCallbackMock);

      const result = await manager.removeTopic('topic-1');

      expect(result).toBe(true); // Subscription removed
      expect(unsubscribeMock).toHaveBeenCalledTimes(1);
      expect(manager.getTopicRefCount('topic-1')).toBe(0);
      expect(manager.getActiveTopics()).not.toContain('topic-1');
      expect(manager.getSubscriptionCount()).toBe(0);
    });

    it('should return false for non-existent topic', async () => {
      const result = await manager.removeTopic('non-existent');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'subscription_manager.remove_topic.not_found',
        { topic: 'non-existent' }
      );
    });

    it('should handle unsubscribe errors', async () => {
      const failingUnsubscribe = jest.fn().mockRejectedValue(new Error('Unsubscribe failed'));
      const subscribe = jest.fn().mockResolvedValue(failingUnsubscribe);

      await manager.addTopic('topic-fail', subscribe);

      await expect(manager.removeTopic('topic-fail')).rejects.toThrow('Unsubscribe failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'subscription_manager.remove_topic.unsubscribe_failed',
        expect.objectContaining({
          topic: 'topic-fail',
          error: 'Unsubscribe failed'
        })
      );
    });

    it('should handle multiple topics independently', async () => {
      const unsubscribe1 = jest.fn().mockResolvedValue(undefined);
      const unsubscribe2 = jest.fn().mockResolvedValue(undefined);
      const subscribe1 = jest.fn().mockResolvedValue(unsubscribe1);
      const subscribe2 = jest.fn().mockResolvedValue(unsubscribe2);

      // Add 2 topics
      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-2', subscribe2);

      // Remove topic-1
      await manager.removeTopic('topic-1');

      expect(unsubscribe1).toHaveBeenCalledTimes(1);
      expect(unsubscribe2).not.toHaveBeenCalled();
      expect(manager.getActiveTopics()).toContain('topic-2');
      expect(manager.getActiveTopics()).not.toContain('topic-1');
      expect(manager.getSubscriptionCount()).toBe(1);
    });
  });

  describe('getActiveTopics', () => {
    it('should return empty array initially', () => {
      expect(manager.getActiveTopics()).toEqual([]);
    });

    it('should return all active topics', async () => {
      const subscribe = jest.fn().mockResolvedValue(jest.fn());

      await manager.addTopic('topic-1', subscribe);
      await manager.addTopic('topic-2', subscribe);
      await manager.addTopic('topic-3', subscribe);

      const topics = manager.getActiveTopics();

      expect(topics).toHaveLength(3);
      expect(topics).toContain('topic-1');
      expect(topics).toContain('topic-2');
      expect(topics).toContain('topic-3');
    });
  });

  describe('getTopicRefCount', () => {
    it('should return 0 for non-existent topic', () => {
      expect(manager.getTopicRefCount('non-existent')).toBe(0);
    });

    it('should return correct ref count', async () => {
      const subscribe = jest.fn().mockResolvedValue(jest.fn());

      await manager.addTopic('topic-1', subscribe);
      expect(manager.getTopicRefCount('topic-1')).toBe(1);

      await manager.addTopic('topic-1', subscribe);
      expect(manager.getTopicRefCount('topic-1')).toBe(2);

      await manager.addTopic('topic-1', subscribe);
      expect(manager.getTopicRefCount('topic-1')).toBe(3);
    });
  });

  describe('getSubscriptionCount', () => {
    it('should return 0 initially', () => {
      expect(manager.getSubscriptionCount()).toBe(0);
    });

    it('should return correct count', async () => {
      const subscribe = jest.fn().mockResolvedValue(jest.fn());

      await manager.addTopic('topic-1', subscribe);
      expect(manager.getSubscriptionCount()).toBe(1);

      await manager.addTopic('topic-2', subscribe);
      expect(manager.getSubscriptionCount()).toBe(2);

      // Add another observer for topic-1 (shouldn't increase count)
      await manager.addTopic('topic-1', subscribe);
      expect(manager.getSubscriptionCount()).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const subscribe = jest.fn().mockResolvedValue(jest.fn());

      await manager.addTopic('topic-1', subscribe);
      await manager.addTopic('topic-1', subscribe); // 2nd observer
      await manager.addTopic('topic-2', subscribe);

      const stats = manager.getStats();

      expect(stats.activeTopics).toBe(2);
      expect(stats.activeSubscriptions).toBe(2);
      expect(stats.topicDetails).toHaveLength(2);
      expect(stats.topicDetails).toContainEqual({ topic: 'topic-1', refCount: 2 });
      expect(stats.topicDetails).toContainEqual({ topic: 'topic-2', refCount: 1 });
    });
  });

  describe('destroy', () => {
    it('should unsubscribe from all topics', async () => {
      const unsubscribe1 = jest.fn().mockResolvedValue(undefined);
      const unsubscribe2 = jest.fn().mockResolvedValue(undefined);
      const subscribe1 = jest.fn().mockResolvedValue(unsubscribe1);
      const subscribe2 = jest.fn().mockResolvedValue(unsubscribe2);

      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-2', subscribe2);

      await manager.destroy();

      expect(unsubscribe1).toHaveBeenCalledTimes(1);
      expect(unsubscribe2).toHaveBeenCalledTimes(1);
      expect(manager.getSubscriptionCount()).toBe(0);
      expect(manager.getActiveTopics()).toEqual([]);
    });

    it('should handle unsubscribe errors gracefully', async () => {
      const unsubscribe1 = jest.fn().mockResolvedValue(undefined);
      const unsubscribe2 = jest.fn().mockRejectedValue(new Error('Unsubscribe failed'));
      const subscribe1 = jest.fn().mockResolvedValue(unsubscribe1);
      const subscribe2 = jest.fn().mockResolvedValue(unsubscribe2);

      await manager.addTopic('topic-1', subscribe1);
      await manager.addTopic('topic-2', subscribe2);

      // Should not throw despite unsubscribe error
      await expect(manager.destroy()).resolves.toBeUndefined();

      expect(unsubscribe1).toHaveBeenCalled();
      expect(unsubscribe2).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'subscription_manager.destroy.unsubscribe_failed',
        expect.objectContaining({
          topic: 'topic-2',
          error: 'Unsubscribe failed'
        })
      );
    });
  });
});
