// Classic Jest CJS mocks (compatible with ts-jest)

jest.mock('firebase-admin', () => ({
  __esModule: true,
  default: {
    initializeApp: jest.fn(),
  },
}));

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: jest.fn(),
}));

describe('common/firebase getFirestore()', () => {
  beforeEach(() => {
    jest.resetModules();
    const admin = require('firebase-admin').default as { initializeApp: jest.Mock };
    const fa = require('firebase-admin/firestore') as { getFirestore: jest.Mock };
    admin.initializeApp.mockReset();
    fa.getFirestore.mockReset();
    process.env.LOG_LEVEL = 'error';
  });

  it('initializes admin once and binds to default database id when not configured', async () => {
    const fa = require('firebase-admin/firestore') as { getFirestore: jest.Mock };
    fa.getFirestore.mockReturnValue({ settings: jest.fn() });

    const { getFirestore } = await import('./firebase');

    const db1 = getFirestore();
    const db2 = getFirestore();

    const admin = require('firebase-admin').default as { initializeApp: jest.Mock };
    expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    expect(fa.getFirestore).toHaveBeenCalledWith('(default)');
    expect(db1).toBe(db2);
    expect(db1.settings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
  });

  it('uses configured databaseId when provided via configureFirestore()', async () => {
    const fa = require('firebase-admin/firestore') as { getFirestore: jest.Mock };
    fa.getFirestore.mockReturnValue({ settings: jest.fn() });

    const mod = await import('./firebase');
    mod.configureFirestore('(default)');
    mod.getFirestore();

    expect(fa.getFirestore).toHaveBeenCalledWith('(default)');
  });
});
