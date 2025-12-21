import { FirestoreUserRepo } from '../user-repo';

describe('FirestoreUserRepo', () => {
  it('throws error when email is undefined (repro)', async () => {
    // Mock Firestore
    const mockDoc = {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn().mockImplementation((data) => {
        // Simulate Firestore's check for undefined
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) {
            throw new Error(`Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value (found in field "${key}").`);
          }
        }
        return Promise.resolve();
      }),
    };
    const mockCollection = {
      doc: jest.fn().mockReturnValue(mockDoc),
    };
    const mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection),
    } as any;

    const repo = new FirestoreUserRepo('users', mockDb);
    
    // This should now succeed because we handle undefined fields
    await expect(repo.ensureUserOnMessage('u-1', { email: undefined }, '2025-01-01T00:00:00Z'))
      .resolves.toBeDefined();
    
    expect(mockDoc.set).toHaveBeenCalled();
    const setData = mockDoc.set.mock.calls[0][0];
    expect(setData.email).toBeUndefined();
    expect(Object.keys(setData)).not.toContain('email');
  });
});
