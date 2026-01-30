import { AuthService } from '../auth';
import { Logger } from '../../../common/logging';
import crypto from 'crypto';

describe('AuthService', () => {
  let authService: AuthService;
  let mockFirestore: any;
  let mockLogger: any;
  let mockDoc: any;

  beforeEach(() => {
    mockDoc = {
      exists: false,
      data: jest.fn(),
      ref: {
        update: jest.fn().mockResolvedValue({})
      }
    };

    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue(mockDoc)
      }),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    authService = new AuthService(mockFirestore, mockLogger);
  });

  it('should return null for empty token', async () => {
    const result = await authService.validateToken('');
    expect(result).toBeNull();
  });

  it('should validate a correct token and cache it', async () => {
    const token = 'bb_pt_test_token';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const userId = 'user-123';

    mockDoc.exists = true;
    mockDoc.data.mockReturnValue({
      uid: userId,
      expires_at: null
    });

    // First call - should hit Firestore
    const result1 = await authService.validateToken(token);
    expect(result1).toBe(userId);
    expect(mockFirestore.collection).toHaveBeenCalledWith('gateways/api/tokens');
    expect(mockFirestore.doc).toHaveBeenCalledWith(hash);

    // Second call - should hit cache
    mockFirestore.collection.mockClear();
    const result2 = await authService.validateToken(token);
    expect(result2).toBe(userId);
    expect(mockFirestore.collection).not.toHaveBeenCalled();
  });

  it('should return null for non-existent token', async () => {
    const token = 'wrong_token';
    mockDoc.exists = false;

    const result = await authService.validateToken(token);
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith('auth.token_not_found', expect.anything());
  });

  it('should return null for expired token', async () => {
    const token = 'expired_token';
    mockDoc.exists = true;
    mockDoc.data.mockReturnValue({
      uid: 'user-123',
      expires_at: {
        toDate: () => new Date(Date.now() - 10000) // 10s ago
      }
    });

    const result = await authService.validateToken(token);
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith('auth.token_expired.db', expect.anything());
  });

  it('should fallback to user_id if uid is missing', async () => {
    const token = 'legacy_token';
    const userId = 'legacy-user';

    mockDoc.exists = true;
    mockDoc.data.mockReturnValue({
      user_id: userId,
      expires_at: null
    });

    const result = await authService.validateToken(token);
    expect(result).toBe(userId);
  });
});
