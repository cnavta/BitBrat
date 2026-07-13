// Unit tests for embedding utilities (sprint-338, BL-338-202)
//
// Coverage: embedText, buildEmbeddingText, cache behavior, error handling.
// All tests use mocked OpenAI API (no real network calls).

import {
  embedText,
  buildEmbeddingText,
  clearEmbeddingCache,
  getEmbeddingCacheStats,
} from '../../../src/common/context/embedding';

// Mock OpenAI
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

describe('buildEmbeddingText', () => {
  it('formats pack with string body correctly', () => {
    const pack = {
      title: 'Test Pack',
      body: 'This is the body content that describes the pack.',
    };

    const result = buildEmbeddingText(pack);
    expect(result).toBe('Test Pack\n\nThis is the body content that describes the pack.');
  });

  it('formats pack with object body correctly (JSON stringified)', () => {
    const pack = {
      title: 'JSON Pack',
      body: { key: 'value', nested: { prop: 'data' } },
    };

    const result = buildEmbeddingText(pack);
    expect(result).toBe('JSON Pack\n\n{"key":"value","nested":{"prop":"data"}}');
  });

  it('truncates body to 500 characters', () => {
    const pack = {
      title: 'Long Pack',
      body: 'x'.repeat(1000),
    };

    const result = buildEmbeddingText(pack);
    expect(result).toBe(`Long Pack\n\n${'x'.repeat(500)}`);
    expect(result.length).toBe('Long Pack\n\n'.length + 500);
  });
});

describe('embedText', () => {
  beforeAll(async () => {
    // Force OpenAI mock to initialize by importing the module
    await import('openai');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearEmbeddingCache();

    // Set OpenAI API key for tests
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Reset mock to successful default
    const mockEmbedding = Array.from({ length: 1536 }, () => 0.5);
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('calls OpenAI API with correct model and input', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    const result = await embedText('test query');

    expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-ada-002',
      input: 'test query',
    });
    expect(result).toEqual(mockEmbedding);
  });

  it('validates embedding dimensions (1536)', async () => {
    const wrongDimEmbedding = Array.from({ length: 512 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: wrongDimEmbedding }],
    });

    const result = await embedText('test query');

    // Should return null on dimension mismatch
    expect(result).toBeNull();
  });

  it('uses custom embedding model when specified', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    const result = await embedText('test query', { model: 'text-embedding-3-small' });

    expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'test query',
    });
    expect(result).toEqual(mockEmbedding);
  });

  it('caches embeddings on first call', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    const result1 = await embedText('same query');
    const result2 = await embedText('same query');

    // OpenAI API should only be called once (second call hits cache)
    expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(mockEmbedding);
    expect(result2).toEqual(mockEmbedding);
  });

  it('bypasses cache for different queries', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    await embedText('query one');
    await embedText('query two');

    // Different queries should trigger separate API calls
    expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(2);
  });

  it('respects cache disable option', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    await embedText('query', { enableCache: false });
    await embedText('query', { enableCache: false });

    // Cache disabled, should call API twice
    expect(mockOpenAI.embeddingsCreate).toHaveBeenCalledTimes(2);
  });

  it('provides cache stats', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    mockOpenAI.embeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    });

    expect(getEmbeddingCacheStats().size).toBe(0);

    await embedText('query');
    expect(getEmbeddingCacheStats().size).toBe(1);

    clearEmbeddingCache();
    expect(getEmbeddingCacheStats().size).toBe(0);
  });

  it('returns null on OpenAI API failure (non-fatal)', async () => {
    mockOpenAI.embeddingsCreate.mockRejectedValue(new Error('OpenAI API timeout'));

    const result = await embedText('test query');

    // Should return null, not throw
    expect(result).toBeNull();
  });

  it('returns null when OPENAI_API_KEY not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await embedText('test query');

    // Should return null (error handled internally)
    expect(result).toBeNull();
  });
});
