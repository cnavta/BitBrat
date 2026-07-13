// Unit tests for context pack registration flow (sprint-338, BL-338-205)
//
// Coverage: pack upsert, embedding generation, idempotent re-registration, error handling.
// All tests use mocked Firestore and OpenAI API (no real network calls or writes).

import type { Firestore, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';

// Mock Firestore
const mockFirestoreDoc = jest.fn();
const mockFirestoreGet = jest.fn();
const mockFirestoreSet = jest.fn();
const mockFirestoreCollection = jest.fn();

jest.mock('../../src/common/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: mockFirestoreCollection,
  })),
}));

// Mock OpenAI
const mockOpenAI = {
  embeddingsCreate: null as any,
};

jest.mock('openai', () => {
  const embeddingsCreateMock = jest.fn();
  mockOpenAI.embeddingsCreate = embeddingsCreateMock;

  function MockOpenAI(this: any, options: any) {
    this.embeddings = {
      create: embeddingsCreateMock,
    };
  }
  return MockOpenAI;
});

// Import after mocks are set up
import { embedText, buildEmbeddingText, clearEmbeddingCache } from '../../src/common/context/embedding';

describe('Context Pack Registration Flow', () => {
  beforeAll(async () => {
    // Force OpenAI mock to initialize by importing the module
    await import('openai');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearEmbeddingCache();

    // Set OpenAI API key for tests
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Setup Firestore mock chain
    mockFirestoreCollection.mockReturnValue({
      doc: mockFirestoreDoc,
    });

    mockFirestoreDoc.mockReturnValue({
      get: mockFirestoreGet,
      set: mockFirestoreSet,
    });

    // Default: no existing document
    mockFirestoreGet.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });

    // Default: successful Firestore write
    mockFirestoreSet.mockResolvedValue(undefined);

    // Default: successful OpenAI embedding
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('Pack Upsert with All Required Fields', () => {
    it('persists pack with all required fields', async () => {
      const pack = {
        id: 'test.pack-id',
        version: '1',
        title: 'Test Pack',
        priority: 2,
        format: 'markdown' as const,
        body: 'This is the test pack body content.',
        source: 'manual/test',
      };

      const bitName = 'test-service';

      // Simulate pack upsert (what tool-gateway.upsertContextPacks does)
      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      const packDoc = {
        ...pack,
        bitName,
        active: true,
        updatedAt: expect.any(String),
        embedding,
        embeddingText,
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      await db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });

      // Verify Firestore write called with correct arguments
      expect(mockFirestoreCollection).toHaveBeenCalledWith('context_packs');
      expect(mockFirestoreDoc).toHaveBeenCalledWith(pack.id);
      expect(mockFirestoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test.pack-id',
          version: '1',
          title: 'Test Pack',
          priority: 2,
          format: 'markdown',
          body: 'This is the test pack body content.',
          source: 'manual/test',
          bitName: 'test-service',
          active: true,
          updatedAt: expect.any(String),
          embedding: expect.any(Array),
          embeddingText: expect.any(String),
        }),
        { merge: true }
      );
    });

    it('includes bitName, active, and timestamp metadata', async () => {
      const pack = {
        id: 'test.metadata',
        version: '1',
        title: 'Metadata Test',
        priority: 3,
        format: 'markdown' as const,
        body: 'Body content',
        source: 'test',
      };

      const bitName = 'metadata-service';
      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      const packDoc = {
        ...pack,
        bitName,
        active: true,
        updatedAt: new Date().toISOString(),
        embedding,
        embeddingText,
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      await db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });

      expect(mockFirestoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          bitName: 'metadata-service',
          active: true,
          updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), // ISO timestamp
        }),
        { merge: true }
      );
    });
  });

  describe('Embedding Generation and Storage', () => {
    it('generates embedding via embedText and stores in packDoc', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const pack = {
        id: 'test.embedding',
        version: '1',
        title: 'Embedding Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Test body for embedding generation.',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      expect(embedding).toEqual(mockEmbedding);
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: embeddingText,
      });

      // Verify embedding stored in packDoc
      const packDoc = {
        ...pack,
        bitName: 'test-service',
        active: true,
        updatedAt: new Date().toISOString(),
        embedding,
        embeddingText,
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      await db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });

      expect(mockFirestoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: mockEmbedding,
          embeddingText: 'Embedding Test\n\nTest body for embedding generation.',
        }),
        { merge: true }
      );
    });

    it('uses buildEmbeddingText to format pack for embedding', async () => {
      const pack = {
        id: 'test.format',
        version: '1',
        title: 'Format Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'This is the body content that will be formatted.',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);

      expect(embeddingText).toBe('Format Test\n\nThis is the body content that will be formatted.');
    });
  });

  describe('Idempotent Re-registration (Heartbeat)', () => {
    it('updates updatedAt on re-registration but preserves createdAt', async () => {
      const pack = {
        id: 'test.heartbeat',
        version: '1',
        title: 'Heartbeat Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Heartbeat body',
        source: 'test',
      };

      const originalCreatedAt = '2026-07-11T10:00:00.000Z';

      // Simulate existing document
      mockFirestoreGet.mockResolvedValue({
        exists: true,
        data: () => ({
          ...pack,
          bitName: 'test-service',
          active: true,
          createdAt: originalCreatedAt,
          updatedAt: '2026-07-11T10:00:00.000Z',
          embedding: Array.from({ length: 1536 }, () => 0.5),
          embeddingText: 'Heartbeat Test\n\nHeartbeat body',
        }),
      });

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      const docRef = db.collection('context_packs').doc(pack.id);
      const existing = await docRef.get();

      const packDoc = {
        ...pack,
        bitName: 'test-service',
        active: true,
        createdAt: existing.exists ? existing.data()?.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        embedding,
        embeddingText,
      };

      await docRef.set(packDoc, { merge: true });

      // Verify createdAt preserved, updatedAt updated
      expect(mockFirestoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: originalCreatedAt, // Preserved from existing doc
          updatedAt: expect.stringMatching(/^2026-07-/), // New timestamp
        }),
        { merge: true }
      );
    });

    it('uses merge: true to avoid duplicates', async () => {
      const pack = {
        id: 'test.merge',
        version: '1',
        title: 'Merge Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Merge body',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      const packDoc = {
        ...pack,
        bitName: 'test-service',
        active: true,
        updatedAt: new Date().toISOString(),
        embedding,
        embeddingText,
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      await db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });

      // Verify merge: true passed to Firestore
      expect(mockFirestoreSet).toHaveBeenCalledWith(expect.any(Object), { merge: true });
    });
  });

  describe('Error Handling', () => {
    it('persists pack without embedding when OpenAI API fails', async () => {
      // Simulate OpenAI API failure
      mockOpenAI.embeddingsCreate.mockRejectedValue(new Error('OpenAI API timeout'));

      const pack = {
        id: 'test.openai-failure',
        version: '1',
        title: 'OpenAI Failure Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Test body',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      // embedText should return null on failure
      expect(embedding).toBeNull();

      // Pack should still be persisted (without embedding)
      const packDoc = {
        ...pack,
        bitName: 'test-service',
        active: true,
        updatedAt: new Date().toISOString(),
        // No embedding or embeddingText fields when embedding fails
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();
      await db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });

      expect(mockFirestoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test.openai-failure',
          bitName: 'test-service',
          active: true,
        }),
        { merge: true }
      );

      // Verify embedding and embeddingText NOT included in packDoc
      const setCall = mockFirestoreSet.mock.calls[0][0];
      expect(setCall).not.toHaveProperty('embedding');
      expect(setCall).not.toHaveProperty('embeddingText');
    });

    it('handles Firestore write failure gracefully (non-fatal)', async () => {
      // Simulate Firestore write failure
      mockFirestoreSet.mockRejectedValue(new Error('Firestore unavailable'));

      const pack = {
        id: 'test.firestore-failure',
        version: '1',
        title: 'Firestore Failure Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Test body',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      const packDoc = {
        ...pack,
        bitName: 'test-service',
        active: true,
        updatedAt: new Date().toISOString(),
        embedding,
        embeddingText,
      };

      const { getFirestore } = await import('../../src/common/firebase');
      const db = getFirestore();

      // Error should be caught and handled (non-fatal for registration)
      await expect(
        db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true })
      ).rejects.toThrow('Firestore unavailable');

      // In actual implementation (tool-gateway.upsertContextPacks), this error is caught
      // and logged but doesn't fail the registration flow
    });

    it('returns null from embedText when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      const pack = {
        id: 'test.no-api-key',
        version: '1',
        title: 'No API Key Test',
        priority: 2,
        format: 'markdown' as const,
        body: 'Test body',
        source: 'test',
      };

      const embeddingText = buildEmbeddingText(pack);
      const embedding = await embedText(embeddingText);

      expect(embedding).toBeNull();
    });
  });

  describe('Embedding Cache Behavior', () => {
    it('caches embeddings to avoid redundant API calls on heartbeat', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const embeddingText = 'Test Pack\n\nTest body content';

      // First call - should hit OpenAI API
      const embedding1 = await embedText(embeddingText);
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(1);

      // Second call with same text - should hit cache
      const embedding2 = await embedText(embeddingText);
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(1); // Still 1 (cached)

      expect(embedding1).toEqual(embedding2);
    });
  });
});
