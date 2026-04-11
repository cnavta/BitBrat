import { EventSubEnvelopeBuilder } from './eventsub-envelope-builder';

describe('EventSubEnvelopeBuilder', () => {
  const builder = new EventSubEnvelopeBuilder();
  const fixedNow = '2026-04-10T21:00:00.000Z';
  const uuid = () => 'test-uuid';

  it('buildStreamOnline should have type system.stream.online', () => {
    const event = {
      id: '123',
      broadcasterId: '456',
      broadcasterName: 'testuser',
      broadcasterDisplayName: 'TestUser',
      title: 'Test Stream',
      type: 'live',
      startDate: new Date(fixedNow)
    };

    const internalEvent = builder.buildStreamOnline(event, { uuid, nowIso: () => fixedNow });
    expect(internalEvent.type).toBe('system.stream.online');
  });

  it('buildStreamOffline should have type system.stream.offline', () => {
    const event = {
      broadcasterId: '456',
      broadcasterName: 'testuser',
      broadcasterDisplayName: 'TestUser'
    };

    const internalEvent = builder.buildStreamOffline(event, { uuid, nowIso: () => fixedNow });
    expect(internalEvent.type).toBe('system.stream.offline');
  });

  it('buildFollow should have type system.twitch.follow', () => {
    const event = {
      userId: '111',
      userName: 'follower',
      userDisplayName: 'Follower',
      broadcasterId: '456',
      broadcasterName: 'testuser',
      broadcasterDisplayName: 'TestUser',
      followDate: new Date(fixedNow)
    };

    const internalEvent = builder.buildFollow(event, { uuid, nowIso: () => fixedNow });
    expect(internalEvent.type).toBe('system.twitch.follow');
  });

  it('buildUpdate should have type system.twitch.update', () => {
    const event = {
      broadcasterId: '456',
      broadcasterName: 'testuser',
      broadcasterDisplayName: 'TestUser',
      streamTitle: 'New Title',
      streamLanguage: 'en',
      categoryId: '1',
      categoryName: 'Gaming',
      isMature: false
    };

    const internalEvent = builder.buildUpdate(event, { uuid, nowIso: () => fixedNow });
    expect(internalEvent.type).toBe('system.twitch.update');
  });
});
