import { EventSubEnvelopeBuilder } from '../eventsub-envelope-builder';

describe('EventSubEnvelopeBuilder', () => {
  const builder = new EventSubEnvelopeBuilder();
  const fixedNow = '2025-12-20T23:20:00.000Z';
  const opts = {
    uuid: () => 'test-uuid',
    nowIso: () => fixedNow,
  };

  test('buildFollow() maps channel.follow correctly', () => {
    const followEvent = {
      userId: '123',
      userName: 'alice',
      userDisplayName: 'Alice',
      broadcasterId: '999',
      broadcasterName: 'bitbrat',
      broadcasterDisplayName: 'BitBrat',
      followDate: new Date('2025-12-20T10:00:00Z'),
    };

    const result = builder.buildFollow(followEvent as any, opts);

    expect(result.type).toBe('system.twitch.follow');
    expect(result.ingress.channel).toBe('#bitbrat');
    expect(result.identity.external.id).toBe('123');
    expect(result.externalEvent).toBeDefined();
    expect(result.externalEvent?.kind).toBe('channel.follow');
    expect(result.externalEvent?.metadata?.userLogin).toBe('alice');
    expect(result.externalEvent?.createdAt).toBe('2025-12-20T10:00:00.000Z');
  });

  test('buildUpdate() maps channel.update correctly', () => {
    const updateEvent = {
      broadcasterId: '999',
      broadcasterName: 'bitbrat',
      broadcasterDisplayName: 'BitBrat',
      streamTitle: 'Coding Sprint',
      streamLanguage: 'en',
      categoryId: '1',
      categoryName: 'Software and Game Development',
      isMature: false,
    };

    const result = builder.buildUpdate(updateEvent as any, opts);

    expect(result.type).toBe('system.twitch.update');
    expect(result.ingress.channel).toBe('#bitbrat');
    expect(result.identity.external.id).toBe('999');
    expect(result.externalEvent).toBeDefined();
    expect(result.externalEvent?.kind).toBe('channel.update');
    expect(result.externalEvent?.metadata?.title).toBe('Coding Sprint');
    expect(result.externalEvent?.createdAt).toBe(fixedNow);
  });

  describe('Tier 1 Event Builders (M3)', () => {
    test('buildRaid() maps channel.raid correctly', () => {
      const raidEvent = {
        raidingBroadcasterId: '123',
        raidingBroadcasterName: 'alice',
        raidingBroadcasterDisplayName: 'Alice',
        raidedBroadcasterId: '999',
        raidedBroadcasterName: 'bitbrat',
        raidedBroadcasterDisplayName: 'BitBrat',
        viewers: 42,
      };

      const result = builder.buildRaid(raidEvent as any, opts);

      expect(result.type).toBe('system.twitch.raid');
      expect(result.ingress.channel).toBe('#alice');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.viewers).toBe(42);
      expect(result.identity.external.metadata?.targetBroadcasterId).toBe('999');
      expect(result.externalEvent).toBeDefined();
      expect(result.externalEvent?.kind).toBe('channel.raid');
      expect(result.externalEvent?.metadata?.viewers).toBe(42);
      expect(result.externalEvent?.createdAt).toBe(fixedNow);
    });

    test('buildSubscribe() maps channel.subscribe correctly', () => {
      const subscribeEvent = {
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        tier: '1000',
        isGift: false,
      };

      const result = builder.buildSubscribe(subscribeEvent as any, opts);

      expect(result.type).toBe('system.twitch.subscribe');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.tier).toBe('1000');
      expect(result.identity.external.metadata?.isGift).toBe(false);
      expect(result.externalEvent).toBeDefined();
      expect(result.externalEvent?.kind).toBe('channel.subscribe');
      expect(result.externalEvent?.metadata?.tier).toBe('1000');
    });

    test('buildSubscriptionMessage() maps channel.subscription.message correctly', () => {
      const subMessageEvent = {
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        tier: '1000',
        cumulativeMonths: 12,
        streakMonths: 6,
        durationMonths: 1,
        messageText: 'Love this stream!',
      };

      const result = builder.buildSubscriptionMessage(subMessageEvent as any, opts);

      expect(result.type).toBe('system.twitch.subscription.message');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.cumulativeMonths).toBe(12);
      expect(result.identity.external.metadata?.streakMonths).toBe(6);
      expect(result.message).toBeDefined();
      expect(result.message?.text).toBe('Love this stream!');
      expect(result.message?.role).toBe('user');
      expect(result.externalEvent?.kind).toBe('channel.subscription.message');
    });

    test('buildSubscriptionMessage() handles missing message text', () => {
      const subMessageEvent = {
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        tier: '1000',
        cumulativeMonths: 12,
        streakMonths: 6,
        durationMonths: 1,
      };

      const result = builder.buildSubscriptionMessage(subMessageEvent as any, opts);

      expect(result.type).toBe('system.twitch.subscription.message');
      expect(result.message).toBeUndefined();
    });

    test('buildSubscriptionGift() maps channel.subscription.gift correctly', () => {
      const giftEvent = {
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        tier: '1000',
        total: 5,
        cumulativeTotal: 20,
        isAnonymous: false,
      };

      const result = builder.buildSubscriptionGift(giftEvent as any, opts);

      expect(result.type).toBe('system.twitch.subscription.gift');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.total).toBe(5);
      expect(result.identity.external.metadata?.cumulativeTotal).toBe(20);
      expect(result.identity.external.metadata?.isAnonymous).toBe(false);
      expect(result.externalEvent?.kind).toBe('channel.subscription.gift');
    });

    test('buildSubscriptionGift() handles anonymous gifts', () => {
      const giftEvent = {
        userId: null,
        userName: null,
        userDisplayName: null,
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        tier: '1000',
        total: 5,
        cumulativeTotal: null,
        isAnonymous: true,
      };

      const result = builder.buildSubscriptionGift(giftEvent as any, opts);

      expect(result.type).toBe('system.twitch.subscription.gift');
      expect(result.identity.external.id).toBe('anonymous');
      expect(result.identity.external.displayName).toBe('Anonymous');
      expect(result.identity.external.metadata?.isAnonymous).toBe(true);
    });

    test('buildCheer() maps channel.cheer correctly', () => {
      const cheerEvent = {
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        bits: 100,
        message: 'cheer100 Great stream!',
        isAnonymous: false,
      };

      const result = builder.buildCheer(cheerEvent as any, opts);

      expect(result.type).toBe('system.twitch.cheer');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.bits).toBe(100);
      expect(result.message).toBeDefined();
      expect(result.message?.text).toBe('cheer100 Great stream!');
      expect(result.message?.role).toBe('user');
      expect(result.externalEvent?.kind).toBe('channel.cheer');
    });

    test('buildCheer() handles anonymous cheers', () => {
      const cheerEvent = {
        userId: null,
        userName: null,
        userDisplayName: null,
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        bits: 100,
        message: 'cheer100',
        isAnonymous: true,
      };

      const result = builder.buildCheer(cheerEvent as any, opts);

      expect(result.identity.external.id).toBe('anonymous');
      expect(result.identity.external.displayName).toBe('Anonymous');
      expect(result.identity.external.metadata?.isAnonymous).toBe(true);
    });

    test('buildChannelPointsRedemption() maps channel.channel_points_custom_reward_redemption.add correctly', () => {
      const redemptionEvent = {
        id: 'reward-123',
        userId: '123',
        userName: 'alice',
        userDisplayName: 'Alice',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        userInput: 'My custom message',
        status: 'fulfilled',
        rewardId: 'reward-id-1',
        rewardTitle: 'Highlight My Message',
        rewardCost: 300,
        rewardPrompt: 'Enter your message',
        redeemedAt: new Date('2025-12-20T12:00:00Z'),
      };

      const result = builder.buildChannelPointsRedemption(redemptionEvent as any, opts);

      expect(result.type).toBe('system.twitch.channel_points.redemption');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('123');
      expect(result.identity.external.metadata?.rewardTitle).toBe('Highlight My Message');
      expect(result.identity.external.metadata?.rewardCost).toBe(300);
      expect(result.identity.external.metadata?.userInput).toBe('My custom message');
      expect(result.externalEvent).toBeDefined();
      expect(result.externalEvent?.kind).toBe('channel.channel_points_custom_reward_redemption.add');
      expect(result.externalEvent?.id).toBe('reward-123');
    });

    test('buildHypeTrainBegin() maps channel.hype_train.begin correctly', () => {
      const hypeTrainEvent = {
        id: 'hype-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        level: 1,
        total: 500,
        progress: 100,
        goal: 500,
        startDate: new Date('2025-12-20T12:00:00Z'),
        expiryDate: new Date('2025-12-20T12:05:00Z'),
        topContributions: [
          { userId: '123', userLogin: 'alice', userDisplayName: 'Alice', type: 'bits', total: 200 },
        ],
      };

      const result = builder.buildHypeTrainBegin(hypeTrainEvent as any, opts);

      expect(result.type).toBe('system.twitch.hype_train.begin');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('999');
      expect(result.identity.external.metadata?.hypeTrainId).toBe('hype-1');
      expect(result.identity.external.metadata?.level).toBe(1);
      expect(result.identity.external.metadata?.progress).toBe(100);
      expect(result.externalEvent?.kind).toBe('channel.hype_train.begin');
      expect(result.externalEvent?.id).toBe('hype-1');
    });

    test('buildHypeTrainProgress() maps channel.hype_train.progress correctly', () => {
      const hypeTrainEvent = {
        id: 'hype-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        level: 2,
        total: 1500,
        progress: 100,
        goal: 1500,
        startDate: new Date('2025-12-20T12:00:00Z'),
        expiryDate: new Date('2025-12-20T12:05:00Z'),
        topContributions: [
          { userId: '123', userLogin: 'alice', userDisplayName: 'Alice', type: 'bits', total: 500 },
        ],
      };

      const result = builder.buildHypeTrainProgress(hypeTrainEvent as any, opts);

      expect(result.type).toBe('system.twitch.hype_train.progress');
      expect(result.identity.external.metadata?.level).toBe(2);
      expect(result.identity.external.metadata?.total).toBe(1500);
      expect(result.externalEvent?.kind).toBe('channel.hype_train.progress');
    });

    test('buildHypeTrainEnd() maps channel.hype_train.end correctly', () => {
      const hypeTrainEvent = {
        id: 'hype-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        level: 3,
        total: 3000,
        startDate: new Date('2025-12-20T12:00:00Z'),
        endDate: new Date('2025-12-20T12:10:00Z'),
        cooldownEndDate: new Date('2025-12-20T13:10:00Z'),
        topContributions: [
          { userId: '123', userLogin: 'alice', userDisplayName: 'Alice', type: 'bits', total: 1000 },
        ],
      };

      const result = builder.buildHypeTrainEnd(hypeTrainEvent as any, opts);

      expect(result.type).toBe('system.twitch.hype_train.end');
      expect(result.identity.external.metadata?.level).toBe(3);
      expect(result.identity.external.metadata?.total).toBe(3000);
      expect(result.externalEvent?.kind).toBe('channel.hype_train.end');
      expect(result.externalEvent?.metadata?.cooldownEndsAt).toBe('2025-12-20T13:10:00.000Z');
    });

    test('buildPollBegin() maps channel.poll.begin correctly', () => {
      const pollEvent = {
        id: 'poll-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        title: 'What should we build next?',
        choices: [
          { id: 'choice-1', title: 'Feature A' },
          { id: 'choice-2', title: 'Feature B' },
        ],
        bitsVotingEnabled: true,
        bitsPerVote: 10,
        channelPointsVotingEnabled: true,
        channelPointsPerVote: 100,
        startDate: new Date('2025-12-20T12:00:00Z'),
        endDate: new Date('2025-12-20T12:05:00Z'),
      };

      const result = builder.buildPollBegin(pollEvent as any, opts);

      expect(result.type).toBe('system.twitch.poll.begin');
      expect(result.identity.external.metadata?.pollId).toBe('poll-1');
      expect(result.identity.external.metadata?.title).toBe('What should we build next?');
      expect(result.externalEvent?.kind).toBe('channel.poll.begin');
      expect(result.externalEvent?.metadata?.choices).toHaveLength(2);
    });

    test('buildPollEnd() maps channel.poll.end correctly', () => {
      const pollEvent = {
        id: 'poll-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        title: 'What should we build next?',
        choices: [
          { id: 'choice-1', title: 'Feature A', bitsVotes: 100, channelPointsVotes: 500, votes: 10 },
          { id: 'choice-2', title: 'Feature B', bitsVotes: 50, channelPointsVotes: 200, votes: 5 },
        ],
        bitsVotingEnabled: true,
        bitsPerVote: 10,
        channelPointsVotingEnabled: true,
        channelPointsPerVote: 100,
        status: 'completed',
        startDate: new Date('2025-12-20T12:00:00Z'),
        endDate: new Date('2025-12-20T12:05:00Z'),
      };

      const result = builder.buildPollEnd(pollEvent as any, opts);

      expect(result.type).toBe('system.twitch.poll.end');
      expect(result.identity.external.metadata?.status).toBe('completed');
      expect(result.externalEvent?.kind).toBe('channel.poll.end');
      expect(result.externalEvent?.metadata?.choices).toHaveLength(2);
    });

    test('buildPredictionBegin() maps channel.prediction.begin correctly', () => {
      const predictionEvent = {
        id: 'pred-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        title: 'Will we finish the sprint today?',
        outcomes: [
          { id: 'outcome-1', title: 'Yes', color: 'blue' },
          { id: 'outcome-2', title: 'No', color: 'pink' },
        ],
        startDate: new Date('2025-12-20T12:00:00Z'),
        lockDate: new Date('2025-12-20T12:05:00Z'),
      };

      const result = builder.buildPredictionBegin(predictionEvent as any, opts);

      expect(result.type).toBe('system.twitch.prediction.begin');
      expect(result.identity.external.metadata?.predictionId).toBe('pred-1');
      expect(result.identity.external.metadata?.title).toBe('Will we finish the sprint today?');
      expect(result.externalEvent?.kind).toBe('channel.prediction.begin');
      expect(result.externalEvent?.metadata?.outcomes).toHaveLength(2);
    });

    test('buildPredictionEnd() maps channel.prediction.end correctly', () => {
      const predictionEvent = {
        id: 'pred-1',
        broadcasterId: '999',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        title: 'Will we finish the sprint today?',
        outcomes: [
          { id: 'outcome-1', title: 'Yes', color: 'blue', users: 50, channelPoints: 10000, topPredictors: [] },
          { id: 'outcome-2', title: 'No', color: 'pink', users: 30, channelPoints: 5000, topPredictors: [] },
        ],
        winningOutcomeId: 'outcome-1',
        status: 'resolved',
        startDate: new Date('2025-12-20T12:00:00Z'),
        endDate: new Date('2025-12-20T12:30:00Z'),
      };

      const result = builder.buildPredictionEnd(predictionEvent as any, opts);

      expect(result.type).toBe('system.twitch.prediction.end');
      expect(result.identity.external.metadata?.status).toBe('resolved');
      expect(result.identity.external.metadata?.winningOutcomeId).toBe('outcome-1');
      expect(result.externalEvent?.kind).toBe('channel.prediction.end');
      expect(result.externalEvent?.metadata?.outcomes).toHaveLength(2);
    });
  });

  // ============================================================================
  // TIER 2 BUILDERS - MODERATION EVENTS
  // ============================================================================

  describe('Tier 2: Moderation Events', () => {
    test('buildBan() maps channel.ban correctly (permanent ban)', () => {
      const banEvent = {
        userId: '456',
        userName: 'baduser',
        userDisplayName: 'BadUser',
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        moderatorId: '789',
        moderatorName: 'moduser',
        moderatorDisplayName: 'ModUser',
        reason: 'Spam',
        startDate: new Date('2026-08-16T12:00:00Z'),
        endDate: null,
        isPermanent: true,
      };

      const result = builder.buildBan(banEvent as any, opts);

      expect(result.type).toBe('system.twitch.moderation.ban');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('456');
      expect(result.identity.external.metadata?.moderatorId).toBe('789');
      expect(result.identity.external.metadata?.reason).toBe('Spam');
      expect(result.identity.external.metadata?.isPermanent).toBe(true);
      expect(result.identity.external.metadata?.duration).toBeNull();
      expect(result.externalEvent?.kind).toBe('channel.ban');
    });

    test('buildBan() maps channel.ban correctly (timeout)', () => {
      const banEvent = {
        userId: '456',
        userName: 'timeoutuser',
        userDisplayName: 'TimeoutUser',
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        moderatorId: '789',
        moderatorName: 'moduser',
        moderatorDisplayName: 'ModUser',
        reason: 'Warning',
        startDate: new Date('2026-08-16T12:00:00Z'),
        endDate: new Date('2026-08-16T12:10:00Z'),
        isPermanent: false,
      };

      const result = builder.buildBan(banEvent as any, opts);

      expect(result.type).toBe('system.twitch.moderation.ban');
      expect(result.identity.external.metadata?.isPermanent).toBe(false);
      expect(result.identity.external.metadata?.duration).toBe(600); // 10 minutes
      expect(result.externalEvent?.metadata?.endsAt).toBe('2026-08-16T12:10:00.000Z');
    });

    test('buildUnban() maps channel.unban correctly', () => {
      const unbanEvent = {
        userId: '456',
        userName: 'unbanneduser',
        userDisplayName: 'UnbannedUser',
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        moderatorId: '789',
        moderatorName: 'moduser',
        moderatorDisplayName: 'ModUser',
      };

      const result = builder.buildUnban(unbanEvent as any, opts);

      expect(result.type).toBe('system.twitch.moderation.unban');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('456');
      expect(result.identity.external.metadata?.moderatorId).toBe('789');
      expect(result.externalEvent?.kind).toBe('channel.unban');
    });

    test('buildModerate() maps channel.moderate correctly', () => {
      const moderateEvent = {
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        moderatorId: '789',
        moderatorName: 'moduser',
        moderatorDisplayName: 'ModUser',
        action: 'delete',
        userId: '456',
        userName: 'targetuser',
        userDisplayName: 'TargetUser',
        reason: 'Inappropriate content',
      };

      const result = builder.buildModerate(moderateEvent as any, opts);

      expect(result.type).toBe('system.twitch.moderation.action');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('789'); // Moderator is identity
      expect(result.identity.external.metadata?.action).toBe('delete');
      expect(result.identity.external.metadata?.targetUserId).toBe('456');
      expect(result.identity.external.metadata?.reason).toBe('Inappropriate content');
      expect(result.externalEvent?.kind).toBe('channel.moderate');
      expect(result.externalEvent?.version).toBe('2');
    });
  });

  // ============================================================================
  // TIER 2 BUILDERS - CHAT EVENTS
  // ============================================================================

  describe('Tier 2: Chat Events', () => {
    test('buildChatMessage() maps channel.chat.message correctly', () => {
      const chatEvent = {
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        chatterId: '456',
        chatterName: 'alice',
        chatterDisplayName: 'Alice',
        messageId: 'msg-123',
        message: {
          text: 'Hello world!',
          fragments: [],
        },
        color: '#FF0000',
        badges: [{ set_id: 'moderator', id: '1', info: '' }],
        messageType: 'text',
      };

      const result = builder.buildChatMessage(chatEvent as any, opts);

      expect(result.type).toBe('chat.message.v1');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('456');
      expect(result.message?.id).toBe('msg-123');
      expect(result.message?.text).toBe('Hello world!');
      expect(result.message?.role).toBe('user');
      expect(result.identity.external.metadata?.color).toBe('#FF0000');
      expect(result.externalEvent?.kind).toBe('channel.chat.message');
    });

    test('buildChatMessage() handles cheer messages', () => {
      const chatEvent = {
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        chatterId: '456',
        chatterName: 'alice',
        chatterDisplayName: 'Alice',
        messageId: 'msg-cheer-123',
        message: {
          text: 'Cheer100 Great stream!',
          fragments: [],
        },
        cheer: { bits: 100 },
      };

      const result = builder.buildChatMessage(chatEvent as any, opts);

      expect(result.type).toBe('chat.message.v1');
      expect(result.externalEvent?.metadata?.cheer).toEqual({ bits: 100 });
    });

    test('buildChatMessageDelete() maps channel.chat.message_delete correctly', () => {
      const deleteEvent = {
        broadcasterId: '123',
        broadcasterName: 'bitbrat',
        broadcasterDisplayName: 'BitBrat',
        targetUserId: '456',
        targetUserName: 'spammer',
        targetUserDisplayName: 'Spammer',
        messageId: 'msg-to-delete',
      };

      const result = builder.buildChatMessageDelete(deleteEvent as any, opts);

      expect(result.type).toBe('system.twitch.chat.message_delete');
      expect(result.ingress.channel).toBe('#bitbrat');
      expect(result.identity.external.id).toBe('456');
      expect(result.identity.external.metadata?.deletedMessageId).toBe('msg-to-delete');
      expect(result.externalEvent?.kind).toBe('channel.chat.message_delete');
    });
  });
});
