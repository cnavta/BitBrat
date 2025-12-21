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

    expect(result.type).toBe('twitch.eventsub.v1');
    expect(result.channel).toBe('#bitbrat');
    expect(result.userId).toBe('123');
    expect(result.externalEvent).toBeDefined();
    expect(result.externalEvent?.kind).toBe('channel.follow');
    expect(result.externalEvent?.payload.userLogin).toBe('alice');
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

    expect(result.type).toBe('twitch.eventsub.v1');
    expect(result.channel).toBe('#bitbrat');
    expect(result.userId).toBe('999');
    expect(result.externalEvent).toBeDefined();
    expect(result.externalEvent?.kind).toBe('channel.update');
    expect(result.externalEvent?.payload.title).toBe('Coding Sprint');
    expect(result.externalEvent?.createdAt).toBe(fixedNow);
  });
});
