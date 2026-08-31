/**
 * Image Generation Integration Tests - Sprint 373
 *
 * Tests end-to-end image generation with different storage drivers.
 * These tests verify the storage abstraction layer works correctly
 * with both filesystem and GCS drivers.
 */

import { ImageGenMcpServer } from './index';
import { FilesystemStorageDriver } from '../../common/storage/drivers/filesystem-driver';
import { GcsStorageDriver } from '../../common/storage/drivers/gcs-driver';
import type { IStorageDriver } from '../../common/storage/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

// TODO: Flaky test - Intermittent NATS connection errors during test suite initialization
// Mock the AI SDK image generation
jest.mock('ai', () => ({
  experimental_generateImage: jest.fn(async () => ({
    image: { base64: Buffer.from('test-image-content').toString('base64') },
  })),
}));

// Mock the provider factory
jest.mock('../../common/llm/provider-factory', () => ({
  getLlmProvider: jest.fn(() => ({ modelId: 'gpt-image-1' })),
}));

describe.skip('Image Generation Integration Tests', () => {
  let server: ImageGenMcpServer;
  let testStorageDir: string;

  beforeAll(async () => {
    // Create temporary storage directory for filesystem driver
    testStorageDir = path.join(tmpdir(), `bitbrat-image-gen-test-${Date.now()}`);
    await fs.mkdir(testStorageDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test storage directory
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    server = new ImageGenMcpServer();
  });

  afterEach(async () => {
    await server.close('test');
  });

  describe('Filesystem Driver Integration', () => {
    it('generates and persists image to filesystem', async () => {
      // Setup filesystem driver
      const driver = new FilesystemStorageDriver({
        basePath: testStorageDir,
        publicUrlBase: 'http://localhost:3100/storage',
      });
      await driver.initialize();

      // Mock getResource to return our driver
      jest.spyOn(server as any, 'getResource').mockReturnValue(driver);
      jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');

      // Mock moderation API
      const fetchSpy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

      // Execute tool
      const tool = (server as any).registeredTools.get('generate_image');
      const res = await tool.handler(
        { prompt: 'a test image for filesystem', aspect_ratio: '1:1' },
        {}
      );

      // Verify successful response
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('http://localhost:3100/storage');
      expect(res.content[0].text).toMatch(/\.png/);

      // Extract filename from response
      const urlMatch = res.content[0].text.match(/http:\/\/localhost:3100\/storage\/([^"\s]+)/);
      expect(urlMatch).not.toBeNull();
      const fileName = urlMatch![1];

      // Verify file exists on filesystem
      const filePath = path.join(testStorageDir, fileName);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify metadata sidecar exists
      const metaPath = `${filePath}.meta.json`;
      const metaExists = await fs.access(metaPath).then(() => true).catch(() => false);
      expect(metaExists).toBe(true);

      // Verify metadata content
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      expect(metaContent).toMatchObject({
        contentType: 'image/png',
        size: 18, // Buffer.from('test-image-content').length
      });
      expect(metaContent.customMetadata).toMatchObject({
        userId: 'anonymous',
        prompt: expect.any(String), // Redacted
        aspectRatio: '1:1',
        model: 'gpt-image-1',
      });

      // Cleanup
      await driver.shutdown();
      fetchSpy.mockRestore();
    });

    it('handles multiple concurrent image generations', async () => {
      const driver = new FilesystemStorageDriver({
        basePath: testStorageDir,
        publicUrlBase: 'http://localhost:3100/storage',
      });
      await driver.initialize();

      jest.spyOn(server as any, 'getResource').mockReturnValue(driver);
      jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');

      const fetchSpy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

      const tool = (server as any).registeredTools.get('generate_image');

      // Generate 3 images concurrently
      const promises = [
        tool.handler({ prompt: 'image 1', aspect_ratio: '1:1' }, {}),
        tool.handler({ prompt: 'image 2', aspect_ratio: '16:9' }, {}),
        tool.handler({ prompt: 'image 3', aspect_ratio: '9:16' }, {}),
      ];

      const results = await Promise.all(promises);

      // Verify all succeeded
      results.forEach(res => {
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain('http://localhost:3100/storage');
      });

      // Verify all have unique filenames
      const urls = results.map(r => r.content[0].text.match(/([a-f0-9-]+\.png)/)?.[1]);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(3);

      await driver.shutdown();
      fetchSpy.mockRestore();
    });
  });

  describe('GCS Driver Integration (Mocked)', () => {
    it('generates and persists image to GCS', async () => {
      // Mock GCS driver (we don't have actual GCS credentials in tests)
      const mockDriver: jest.Mocked<IStorageDriver> = {
        name: 'gcs',
        initialize: jest.fn().mockResolvedValue(undefined),
        upload: jest.fn().mockResolvedValue({
          fileName: 'test-gcs-image.png',
          publicUrl: 'https://storage.googleapis.com/test-bucket/test-gcs-image.png',
          size: 18,
          uploadedAt: new Date().toISOString(),
        }),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getMetadata: jest.fn(),
        list: jest.fn(),
        shutdown: jest.fn(),
      };

      jest.spyOn(server as any, 'getResource').mockReturnValue(mockDriver);
      jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');

      const fetchSpy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

      const tool = (server as any).registeredTools.get('generate_image');
      const res = await tool.handler(
        { prompt: 'a test image for GCS', aspect_ratio: '1:1' },
        {}
      );

      // Verify successful response
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('https://storage.googleapis.com/test-bucket/');

      // Verify driver upload was called with correct metadata
      expect(mockDriver.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/\.png$/),
        expect.objectContaining({
          contentType: 'image/png',
          size: 18,
          customMetadata: expect.objectContaining({
            userId: 'anonymous',
            aspectRatio: '1:1',
            model: 'gpt-image-1',
          }),
        })
      );

      fetchSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('handles storage upload failures gracefully', async () => {
      // Create driver that fails on upload
      const failingDriver: jest.Mocked<IStorageDriver> = {
        name: 'failing-driver',
        initialize: jest.fn().mockResolvedValue(undefined),
        upload: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getMetadata: jest.fn(),
        list: jest.fn(),
        shutdown: jest.fn(),
      };

      jest.spyOn(server as any, 'getResource').mockReturnValue(failingDriver);
      jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');

      const fetchSpy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

      const tool = (server as any).registeredTools.get('generate_image');
      const res = await tool.handler({ prompt: 'failing image', aspect_ratio: '1:1' }, {});

      // Verify error response
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Failed to generate or persist image');
      expect(res.content[0].text).toContain('Storage unavailable');

      fetchSpy.mockRestore();
    });

    it('handles missing storage driver', async () => {
      jest.spyOn(server as any, 'getResource').mockReturnValue(null);
      jest.spyOn(server as any, 'getSecret').mockResolvedValue('test-openai-key');

      const fetchSpy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ flagged: false, categories: {} }] }),
      } as any);

      const tool = (server as any).registeredTools.get('generate_image');
      const res = await tool.handler({ prompt: 'no storage', aspect_ratio: '1:1' }, {});

      // Verify error response
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Storage driver not initialized');

      fetchSpy.mockRestore();
    });
  });
});
