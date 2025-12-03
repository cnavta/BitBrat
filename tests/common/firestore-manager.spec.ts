jest.mock('../../src/common/firebase', () => {
  const inst = { __tag: 'db' } as any;
  return { getFirestore: jest.fn(() => inst), __db: inst };
});

import { FirestoreManager } from '../../src/common/resources/firestore-manager';

describe('FirestoreManager', () => {
  it('returns the getFirestore() singleton and shutdown is no-op', async () => {
    const mgr = new FirestoreManager();
    const res = mgr.setup({} as any);
    const mod: any = require('../../src/common/firebase');
    expect(res).toBe(mod.__db);
    await expect(mgr.shutdown(res as any)).resolves.toBeUndefined();
  });
});
