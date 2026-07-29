import request from 'supertest';
import { ImageGenMcpServer } from './index';
import type { IStorageDriver, StorageUploadResult } from '../../common/storage/types';

// Mock the AI SDK image generation so the handler can run without a real OpenAI call.
jest.mock('ai', () => ({
  experimental_generateImage: jest.fn(async () => ({
    image: { base64: Buffer.from('fake-image-bytes').toString('base64') },
  })),
}));

// Mock the provider factory so getLlmProvider doesn't require real credentials.
jest.mock('../../common/llm/provider-factory', () => ({
  getLlmProvider: jest.fn(() => ({ modelId: 'gpt-image-1' })),
}));

describe('image-gen-mcp', () => {
  let server: ImageGenMcpServer;

  beforeAll(async () => {
    server = new ImageGenMcpServer();
    // We don't necessarily need to call server.start() if we just want to test routes via supertest
  });

  afterAll(async () => {
    await server.close('test');
  });

  it('GET /health returns 200', async () => {
    const response = await request(server.getApp()).get('/health');
    expect(response.status).toBe(200);
    // BaseServer response might differ slightly if it uses registerHealth, but let's assume our override for now
    expect(response.body.status).toBe('ok');
  });

  it('generate_image tool is registered', async () => {
    const registeredTools = (server as any).registeredTools;
    expect(registeredTools.has('generate_image')).toBe(true);
  });

  it('uploads image using storage driver abstraction', async () => {
    // Create mock storage driver
    const mockUploadResult: StorageUploadResult = {
      fileName: 'test-uuid.png',
      publicUrl: 'https://storage.example.com/test-uuid.png',
      size: 16,
      uploadedAt: new Date().toISOString(),
    };

    const mockDriver: jest.Mocked<IStorageDriver> = {
      name: 'mock-driver',
      initialize: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(mockUploadResult),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getMetadata: jest.fn(),
      list: jest.fn(),
      shutdown: jest.fn(),
    };

    jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');
    jest.spyOn(server as any, 'getResource').mockReturnValue(mockDriver);

    // Moderation call uses global fetch; stub it to a clean (not flagged) response.
    const fetchSpy = jest
      .spyOn(global as any, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

    const tool = (server as any).registeredTools.get('generate_image');
    const res = await tool.handler({ prompt: 'a tiny test image', aspect_ratio: '1:1' }, {});

    expect(res.isError).toBeFalsy();
    expect(mockDriver.upload).toHaveBeenCalledTimes(1);

    // Verify upload was called with correct metadata
    const uploadCall = mockDriver.upload.mock.calls[0];
    expect(uploadCall[0]).toBeInstanceOf(Buffer); // imageBuffer
    expect(uploadCall[1]).toMatch(/\.png$/); // fileName
    expect(uploadCall[2]).toMatchObject({
      contentType: 'image/png',
      size: 16, // Buffer.from('fake-image-bytes').length
    });
    expect(uploadCall[2].customMetadata).toBeDefined();

    // Verify public URL is returned in response
    expect(res.content[0].text).toContain(mockUploadResult.publicUrl);

    fetchSpy.mockRestore();
  });
});
