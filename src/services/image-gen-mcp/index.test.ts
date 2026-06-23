import request from 'supertest';
import { ImageGenMcpServer } from './index';

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

  it('persists with a simple (non-resumable) upload to stay undici-compatible', async () => {
    // The resumable-upload path in @google-cloud/storage attaches an `abort-controller`
    // signal that undici (our pinned auth transport) rejects with
    // `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.`.
    // Forcing `resumable: false` avoids that path, so guard it with a regression test.
    const save = jest.fn().mockResolvedValue(undefined);
    const file = jest.fn(() => ({ save }));
    const fakeStorage = { bucket: jest.fn(() => ({ file })) };

    jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');
    jest.spyOn(server as any, 'getResource').mockReturnValue(fakeStorage);

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
    expect(save).toHaveBeenCalledTimes(1);
    const saveOptions = save.mock.calls[0][1];
    expect(saveOptions).toMatchObject({ resumable: false });

    fetchSpy.mockRestore();
  });
});
