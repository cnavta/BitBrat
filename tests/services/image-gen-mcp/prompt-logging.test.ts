import { ImageGenMcpServer } from '../../../src/services/image-gen-mcp/index';
import { features } from '../../../src/common/feature-flags';
import { getFirestore } from '../../../src/common/firebase';
import { redactText } from '../../../src/common/prompt-assembly/redaction';
import { experimental_generateImage as generateImage } from 'ai';

jest.mock('../../../src/common/firebase', () => ({
  getFirestore: jest.fn(),
}));

jest.mock('../../../src/common/prompt-assembly/redaction', () => ({
  redactText: jest.fn((text: string) => text), // Default to no redaction for tests
}));

jest.mock('ai', () => ({
  experimental_generateImage: jest.fn(),
}));

jest.mock('../../../src/common/llm/provider-factory', () => ({
  getLlmProvider: jest.fn(() => ({})),
}));

describe('image-gen-mcp generate_image — Prompt Logging', () => {
  let server: ImageGenMcpServer;
  let mockAdd: jest.Mock;
  let mockCollection: jest.Mock;
  let mockSave: jest.Mock;
  let mockLogger: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock; error: jest.Mock };

  function setModerationFlagged(flagged: boolean, categories: Record<string, boolean> = {}) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged, categories }] }),
    } as any);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    features.reset();

    // Restore the default passthrough redaction (clearAllMocks keeps implementations).
    (redactText as jest.Mock).mockImplementation((text: string) => text);

    // Firestore mock mirroring tests/services/llm-bot/prompt-logging.test.ts
    mockAdd = jest.fn().mockResolvedValue({ id: 'doc-123' });
    const mockCollectionInner = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDoc = jest.fn().mockReturnValue({ collection: mockCollectionInner });
    mockCollection = jest.fn().mockImplementation((name: string) => {
      if (name === 'services') return { doc: mockDoc };
      return { add: mockAdd };
    });
    (getFirestore as jest.Mock).mockReturnValue({ collection: mockCollection });

    // Default: image generation succeeds.
    (generateImage as jest.Mock).mockResolvedValue({
      image: { base64: Buffer.from('fake-image-bytes').toString('base64') },
    });

    // Default: moderation passes.
    global.fetch = jest.fn();
    setModerationFlagged(false);

    server = new ImageGenMcpServer();

    // Stub out external/inherited dependencies so no live calls occur.
    mockSave = jest.fn().mockResolvedValue(undefined);
    const mockBucket = { file: jest.fn().mockReturnValue({ save: mockSave }) };
    const mockStorage = { bucket: jest.fn().mockReturnValue(mockBucket) };

    mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');
    jest.spyOn(server as any, 'getResource').mockReturnValue(mockStorage);
    jest.spyOn(server as any, 'getLogger').mockReturnValue(mockLogger);
  });

  test('does NOT write to Firestore when the feature flag is disabled', async () => {
    features.setOverride('llm.promptLogging.enabled', 'false');

    const result = await server.executeTool('generate_image', { prompt: 'a happy cat', aspect_ratio: '1:1' });

    expect(result.isError).toBeFalsy();
    expect(mockCollection).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('flag on, success: writes exactly one log with status success, redacted prompt and image.url', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    (redactText as jest.Mock).mockImplementation((text: string) => `REDACTED: ${text}`);

    const result = await server.executeTool('generate_image', { prompt: 'a happy cat', aspect_ratio: '16:9' });

    expect(result.isError).toBeFalsy();
    expect(mockCollection).toHaveBeenCalledWith('services');
    expect(mockAdd).toHaveBeenCalledTimes(1);

    const doc = mockAdd.mock.calls[0][0];
    expect(doc.status).toBe('success');
    expect(doc.platform).toBe('openai');
    expect(doc.prompt).toBe('REDACTED: a happy cat');
    expect(doc.response).toMatch(/^REDACTED: https:\/\/storage\.googleapis\.com\//);
    expect(doc.aspectRatio).toBe('16:9');
    expect(doc.size).toBe('1536x1024');
    expect(typeof doc.processingTimeMs).toBe('number');
    expect(doc.image).toEqual(
      expect.objectContaining({ url: expect.stringContaining('https://storage.googleapis.com/'), contentType: 'image/png' }),
    );
    expect(doc.moderation).toEqual({ flagged: false, categories: [] });
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  test('flag on, moderation rejection: writes one log with status rejected and moderation.flagged', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    setModerationFlagged(true, { violence: true, hate: false });

    const result = await server.executeTool('generate_image', { prompt: 'something nasty', aspect_ratio: '1:1' });

    expect(result.isError).toBe(true);
    expect(mockAdd).toHaveBeenCalledTimes(1);

    const doc = mockAdd.mock.calls[0][0];
    expect(doc.status).toBe('rejected');
    expect(doc.response).toBe('moderation_rejected');
    expect(doc.moderation).toEqual({ flagged: true, categories: ['violence'] });
    expect(doc.image).toBeUndefined();
    // Generation must never run for a flagged prompt.
    expect(generateImage as jest.Mock).not.toHaveBeenCalled();
  });

  test('flag on, error path: writes one log with status error and a redacted error', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    (generateImage as jest.Mock).mockRejectedValue(new Error('model exploded'));

    const result = await server.executeTool('generate_image', { prompt: 'a happy cat', aspect_ratio: '1:1' });

    expect(result.isError).toBe(true);
    expect(mockAdd).toHaveBeenCalledTimes(1);

    const doc = mockAdd.mock.calls[0][0];
    expect(doc.status).toBe('error');
    expect(doc.response).toBe('error');
    // The error message is passed through redactText before being logged.
    expect(redactText).toHaveBeenCalledWith('model exploded');
    expect(doc.error).toBe('model exploded');
    expect(doc.image).toBeUndefined();
  });

  test('fail-soft: a Firestore write rejection does not affect the tool result, and a warning is logged', async () => {
    features.setOverride('llm.promptLogging.enabled', 'true');
    mockAdd.mockRejectedValue(new Error('Firestore Down'));

    const result = await server.executeTool('generate_image', { prompt: 'a happy cat', aspect_ratio: '1:1' });

    // The tool still returns its normal success payload.
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as any).text).toContain('Image generated and persisted!');

    // Allow the fire-and-forget .catch() to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'image_gen_mcp.prompt_logging_failed',
      expect.objectContaining({ error: 'Firestore Down' }),
    );
  });
});
