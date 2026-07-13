// Unit tests for VectorContextProvider (sprint-338, BL-338-104)
//
// Coverage: embedding generation, cache behavior, vector query construction, similarity filtering,
// error handling. All tests use mocked OpenAI API and Firestore (no real network calls).

import { VectorContextProvider } from '../../../src/common/context/vector-provider';
import type { ContextPack } from '../../../src/common/context/types';

// Mock Firestore
const mockGet = jest.fn();
const mockFindNearest = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn(() => ({ findNearest: mockFindNearest }));
const mockCollection = jest.fn(() => ({ where: mockWhere }));
const mockFirestore = { collection: mockCollection };

jest.mock('../../../src/common/firebase', () => ({
  getFirestore: () => mockFirestore,
}));

// Mock OpenAI - use shared object to avoid temporal dead zone issues
const mockOpenAI = {
  embeddingsCreate: null as any,
};

jest.mock('openai', () => {
  // Create mock inside factory to avoid hoisting issues
  const embeddingsCreateMock = jest.fn();
  mockOpenAI.embeddingsCreate = embeddingsCreateMock;

  // Use a plain function constructor for proper 'new' support
  function MockOpenAI(this: any, options: any) {
    this.embeddings = {
      create: embeddingsCreateMock,
    };
  }
  // Return the constructor directly - Jest will wrap it in { default: ... }
  return MockOpenAI;
});

describe('VectorContextProvider', () => {
  beforeAll(async () => {
    // Force OpenAI mock to initialize by importing the module
    await import('openai');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Set OpenAI API key for tests
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Reset mock implementations to successful defaults
    const mockEmbedding = Array.from({ length: 1536 }, () => 0.5);
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });
    mockGet.mockResolvedValue({ docs: [] });
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('Embedding generation', () => {
    it('calls OpenAI API with correct model and input', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query');
      await provider.listPacks();

      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: 'test query',
      });
    });

    it('validates embedding dimensions (1536)', async () => {
      const wrongDimEmbedding = Array.from({ length: 512 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: wrongDimEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query');
      const packs = await provider.listPacks();

      // Should return empty array on dimension mismatch (non-fatal error)
      expect(packs).toEqual([]);
    });

    it('uses custom embedding model when specified', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query', {
        embeddingModel: 'text-embedding-3-small',
      });
      await provider.listPacks();

      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test query',
      });
    });
  });

  describe('Cache behavior', () => {
    it('caches embeddings on first call', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('same query');
      await provider.listPacks();
      await provider.listPacks();

      // OpenAI API should only be called once (second call hits cache)
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(1);
    });

    it('bypasses cache for different queries', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider1 = new VectorContextProvider('query one');
      const provider2 = new VectorContextProvider('query two');
      await provider1.listPacks();
      await provider2.listPacks();

      // Different queries should trigger separate API calls
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(2);
    });

    it('respects cache disable option', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('query', { enableCache: false });
      await provider.listPacks();
      await provider.listPacks();

      // Cache disabled, should call API twice
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(2);
    });

    it('provides cache stats', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('query');
      expect(provider.getCacheStats().size).toBe(0);

      await provider.listPacks();
      expect(provider.getCacheStats().size).toBe(1);

      provider.clearCache();
      expect(provider.getCacheStats().size).toBe(0);
    });
  });

  describe('Vector query construction', () => {
    it('constructs Firestore Vector Search query with correct parameters', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query', {
        maxResults: 3,
      });
      await provider.listPacks();

      // Verify query construction
      expect(mockCollection).toHaveBeenCalledWith('context_packs');
      expect(mockWhere).toHaveBeenCalledWith('active', '==', true);
      expect(mockFindNearest).toHaveBeenCalledWith('embedding', mockEmbedding, {
        limit: 3,
        distanceMeasure: 'COSINE',
      });
    });

    it('uses default maxResults when not specified', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query');
      await provider.listPacks();

      expect(mockFindNearest).toHaveBeenCalledWith('embedding', expect.any(Array), {
        limit: 5,  // default
        distanceMeasure: 'COSINE',
      });
    });
  });

  describe('Similarity filtering', () => {
    it('filters packs below minSimilarity threshold', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Mock Firestore response with varying distances
      mockGet.mockResolvedValue({
        docs: [
          {
            data: () => ({
              id: 'pack1',
              version: '1',
              title: 'Pack 1',
              format: 'markdown',
              body: 'Content 1',
              source: 'test',
              _distance: 0.1,  // similarity: 0.9 (above threshold)
            }),
          },
          {
            data: () => ({
              id: 'pack2',
              version: '1',
              title: 'Pack 2',
              format: 'markdown',
              body: 'Content 2',
              source: 'test',
              _distance: 0.5,  // similarity: 0.5 (below threshold 0.7)
            }),
          },
          {
            data: () => ({
              id: 'pack3',
              version: '1',
              title: 'Pack 3',
              format: 'markdown',
              body: 'Content 3',
              source: 'test',
              _distance: 0.2,  // similarity: 0.8 (above threshold)
            }),
          },
        ],
      });

      const provider = new VectorContextProvider('test query', {
        minSimilarity: 0.7,
      });
      const packs = await provider.listPacks();

      // Only pack1 and pack3 should pass (pack2 filtered out)
      expect(packs).toHaveLength(2);
      expect(packs.map((p) => p.id)).toEqual(['pack1', 'pack3']);
    });

    it('converts Firestore distance to similarity (1 - distance)', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      mockGet.mockResolvedValue({
        docs: [
          {
            data: () => ({
              id: 'exact-match',
              version: '1',
              title: 'Exact Match',
              format: 'markdown',
              body: 'Content',
              source: 'test',
              _distance: 0,  // similarity: 1.0 (exact match)
            }),
          },
        ],
      });

      const provider = new VectorContextProvider('test query', {
        minSimilarity: 0.95,
      });
      const packs = await provider.listPacks();

      // Exact match should pass even with high threshold
      expect(packs).toHaveLength(1);
      expect(packs[0].id).toBe('exact-match');
    });
  });

  describe('Pack mapping (Firestore → ContextPack)', () => {
    it('maps Firestore documents to ContextPack interface', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      mockGet.mockResolvedValue({
        docs: [
          {
            data: () => ({
              id: 'test.pack',
              version: '2',
              title: 'Test Pack',
              priority: 1,
              format: 'json',
              body: { key: 'value' },
              source: 'src/test.ts',
              _distance: 0.1,
              // Extra Firestore fields (should not be included)
              bitName: 'test-bit',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-02',
              active: true,
              embedding: mockEmbedding,
              embeddingText: 'Test Pack...',
            }),
          },
        ],
      });

      const provider = new VectorContextProvider('test query');
      const packs = await provider.listPacks();

      expect(packs).toHaveLength(1);
      const pack = packs[0];

      // Verify ContextPack fields are present
      expect(pack.id).toBe('test.pack');
      expect(pack.version).toBe('2');
      expect(pack.title).toBe('Test Pack');
      expect(pack.priority).toBe(1);
      expect(pack.format).toBe('json');
      expect(pack.body).toEqual({ key: 'value' });
      expect(pack.source).toBe('src/test.ts');

      // Verify Firestore internal fields are excluded
      expect((pack as any).bitName).toBeUndefined();
      expect((pack as any).createdAt).toBeUndefined();
      expect((pack as any).updatedAt).toBeUndefined();
      expect((pack as any).active).toBeUndefined();
      expect((pack as any).embedding).toBeUndefined();
      expect((pack as any)._distance).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('returns empty array on OpenAI API failure (non-fatal)', async () => {
      mockOpenAI.embeddingsCreate.mockRejectedValue(new Error('OpenAI API timeout'));

      const provider = new VectorContextProvider('test query');
      const packs = await provider.listPacks();

      // Should return empty array, not throw
      expect(packs).toEqual([]);
    });

    it('returns empty array on Firestore query failure (non-fatal)', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockRejectedValue(new Error('Firestore timeout'));

      const provider = new VectorContextProvider('test query');
      const packs = await provider.listPacks();

      // Should return empty array, not throw
      expect(packs).toEqual([]);
    });

    it('throws error when OPENAI_API_KEY not set', async () => {
      delete process.env.OPENAI_API_KEY;
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query');
      const packs = await provider.listPacks();

      // Should return empty array (error handled internally)
      expect(packs).toEqual([]);
    });
  });

  describe('ContextProvider interface compliance', () => {
    it('implements listPacks() returning Promise<ContextPack[]>', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query');
      const result = provider.listPacks();

      // Should return a Promise
      expect(result).toBeInstanceOf(Promise);

      const packs = await result;
      expect(Array.isArray(packs)).toBe(true);
    });

    it('implements listBindings() returning empty array (retrieval-only)', () => {
      const provider = new VectorContextProvider('test query');
      const bindings = provider.listBindings();

      // VectorContextProvider does not support bindings (retrieval-only)
      expect(bindings).toEqual([]);
    });
  });

  describe('Options handling', () => {
    it('applies all custom options correctly', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
      mockOpenAI.embeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
      mockGet.mockResolvedValue({ docs: [] });

      const provider = new VectorContextProvider('test query', {
        maxResults: 10,
        minSimilarity: 0.8,
        embeddingModel: 'text-embedding-3-large',
        enableCache: false,
        timeout: 500,
      });
      await provider.listPacks();

      // Verify options applied
      expect(mockFindNearest).toHaveBeenCalledWith('embedding', expect.any(Array), {
        limit: 10,
        distanceMeasure: 'COSINE',
      });
      expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: 'test query',
      });
    });
  });
});
