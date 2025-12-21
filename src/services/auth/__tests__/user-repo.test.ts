import { FirestoreUserRepo, AuthUserDoc } from '../user-repo';
import { getFirestore } from '../../../common/firebase';

// Mock getFirestore to return a mock DB
jest.mock('../../../common/firebase', () => ({
  getFirestore: jest.fn(),
}));

describe('FirestoreUserRepo Integration-ish', () => {
  let repo: FirestoreUserRepo;
  let mockDb: any;
  let mockDoc: any;
  let mockCollection: any;

  beforeEach(() => {
    mockDoc = {
      get: jest.fn(),
      set: jest.fn(),
    };
    mockCollection = {
      doc: jest.fn().mockReturnValue(mockDoc),
    };
    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection),
    };
    (getFirestore as jest.Mock).mockReturnValue(mockDb);
    repo = new FirestoreUserRepo('users', mockDb);
  });

  test('ensureUserOnMessage merges roles and rolesMeta correctly', async () => {
    const existingData = {
      id: 'twitch:123',
      roles: ['subscriber'],
      rolesMeta: {
        twitch: ['subscriber'],
      },
      messageCountAllTime: 5,
      lastMessageAt: '2025-01-01T00:00:00Z',
    };

    mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => existingData,
    });

    const nowIso = '2025-01-01T01:00:00Z';
    const newData = {
      provider: 'discord',
      roles: ['moderator'],
      rolesMeta: {
        discord: ['ModRole'],
      },
    };

    const res = await repo.ensureUserOnMessage('twitch:123', newData, nowIso);

    expect(res.doc.roles).toEqual(expect.arrayContaining(['subscriber', 'moderator']));
    expect(res.doc.rolesMeta?.twitch).toEqual(['subscriber']);
    expect(res.doc.rolesMeta?.discord).toEqual(['ModRole']);

    const updateCall = mockDoc.set.mock.calls[0][0];
    expect(updateCall.roles).toEqual(expect.arrayContaining(['subscriber', 'moderator']));
    expect(updateCall.rolesMeta.twitch).toEqual(['subscriber']);
    expect(updateCall.rolesMeta.discord).toEqual(['ModRole']);
  });

  test('ensureUserOnMessage initializes new user with profile and roles', async () => {
    mockDoc.get.mockResolvedValue({
      exists: false,
    });

    const nowIso = '2025-01-01T01:00:00Z';
    const newData = {
      provider: 'twitch',
      profile: { username: 'alice', updatedAt: nowIso },
      roles: ['subscriber'],
      rolesMeta: { twitch: ['subscriber'] },
    };

    const res = await repo.ensureUserOnMessage('twitch:123', newData, nowIso);

    expect(res.created).toBe(true);
    expect(res.doc.profile?.username).toBe('alice');
    expect(res.doc.roles).toEqual(['subscriber']);
    expect(res.doc.rolesMeta?.twitch).toEqual(['subscriber']);

    const initialCall = mockDoc.set.mock.calls[0][0];
    expect(initialCall.profile.username).toBe('alice');
    expect(initialCall.roles).toEqual(['subscriber']);
  });
});
