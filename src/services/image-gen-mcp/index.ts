import { Request, Response } from 'express';
import { McpServer } from '../../common/mcp-server';
import { experimental_generateImage as generateImage } from 'ai';
import { getLlmProvider } from '../../common/llm/provider-factory';
import { StorageManager } from '../../common/resources/storage-manager';
import type { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

/**
 * ImageGenMcpServer
 * Handles image generation requests via MCP, now using the standard McpServer base class.
 */
export class ImageGenMcpServer extends McpServer {
  private lastRequestByUser: Map<string, number> = new Map();

  constructor() {
    super({
      serviceName: 'image-gen-mcp',
      healthPaths: ['/health'],
      resources: {
        storage: new StorageManager(),
      },
    });

    this.setupMcpTools();
  }

  private setupMcpTools() {
    this.registerTool(
      'generate_image',
      'Generate an image based on a prompt using DALL-E 3 and persist it to GCS.',
      z.object({
        prompt: z.string().describe('The descriptive prompt for the image.'),
        aspect_ratio: z.enum(['1:1', '16:9', '9:16']).optional().default('1:1').describe('The aspect ratio of the generated image.'),
      }),
      async (args, extra) => {
        const { prompt, aspect_ratio: aspectRatio } = args;

        // 0. Rate Limiting (RBAC handled by tool-gateway)
        const userId = (extra as any)?.userId || 'anonymous';
        
        this.getLogger().info('Image generation requested', { prompt, aspectRatio, userId });

        // Rate limiting: 1 per 5 mins per user (default)
        const rateLimitMs = this.getConfig('IMAGE_GEN_RATE_LIMIT_MS', { default: 5 * 60 * 1000 });
        const now = Date.now();
        const lastRequest = this.lastRequestByUser.get(userId) || 0;
        
        if (now - lastRequest < rateLimitMs && userId !== 'anonymous') {
          const remaining = Math.ceil((rateLimitMs - (now - lastRequest)) / 1000);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Rate limit exceeded. Please wait ${remaining} seconds.`,
              },
            ],
          };
        }

        try {
          const apiKey = await this.getSecret('OPENAI_API_KEY');

          // 1. Moderation Check (BL-004)
          this.getLogger().debug('Checking moderation', { prompt });
          const modRes = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ input: prompt }),
          });

          if (!modRes.ok) {
            throw new Error(`Moderation API error: ${modRes.statusText}`);
          }

          const modJson: any = await modRes.json();
          const result = modJson.results[0];

          if (result.flagged) {
            const categories = Object.entries(result.categories)
              .filter(([_, flagged]) => flagged)
              .map(([cat]) => cat);
            
            this.getLogger().warn('Prompt flagged by moderation', { prompt, categories });
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Prompt rejected by moderation. Flagged categories: ${categories.join(', ')}`,
                },
              ],
            };
          }

          // 2. Image Generation (BL-003)
          const provider = getLlmProvider({
            provider: 'openai',
            model: 'dall-e-3',
            apiKey,
          });

          // Map aspectRatio to size for DALL-E 3 (AI SDK requirement)
          const size = aspectRatio === '16:9' ? '1792x1024' : (aspectRatio === '9:16' ? '1024x1792' : '1024x1024');

          const genResult = await generateImage({
            model: provider as any,
            prompt,
            size: size as any,
          });

          this.getLogger().info('Image generated successfully, preparing GCS upload');

          // 3. Persist to GCS (BL-005)
          const storage = this.getResource<Storage>('storage');
          if (!storage) {
            throw new Error('Storage resource not initialized');
          }

          const bucketName = this.getConfig('GCS_BUCKET_NAME', { default: 'bitbrat-media-gen' });
          const fileName = `${uuidv4()}.png`;
          const bucket = storage.bucket(bucketName);
          const file = bucket.file(fileName);

          // Upload the image data
          if (genResult.image.base64) {
            await file.save(Buffer.from(genResult.image.base64, 'base64'), {
              metadata: { contentType: 'image/png' },
            });
          } else if (genResult.image.uint8Array) {
            await file.save(Buffer.from(genResult.image.uint8Array), {
              metadata: { contentType: 'image/png' },
            });
          } else {
            throw new Error('No image data returned from generation');
          }

          const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
          
          this.getLogger().info('Image persisted to GCS', { publicUrl });

          // Update rate limit timestamp after successful generation
          if (userId !== 'anonymous') {
            this.lastRequestByUser.set(userId, now);
          }

          return {
            content: [
              {
                type: 'text',
                text: `Image generated and persisted! URL: ${publicUrl}\n\nNote: This link is ephemeral and will expire in 48 hours.`,
              },
              {
                type: 'image',
                data: genResult.image.base64 || '',
                mimeType: 'image/png',
              }
            ],
          };
        } catch (error: any) {
          this.getLogger().error('Image generation or persistence failed', { error: error.message, prompt });
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Failed to generate or persist image: ${error.message}`,
              },
            ],
          };
        }
      }
    );
  }
}

if (require.main === module) {
  const server = new ImageGenMcpServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start image-gen-mcp:', err);
    process.exit(1);
  });
}
