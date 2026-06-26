import { Request, Response } from 'express';
import { Bit } from '../../common/base-server';
import { experimental_generateImage as generateImage } from 'ai';
import { getLlmProvider } from '../../common/llm/provider-factory';
import { StorageManager } from '../../common/resources/storage-manager';
import { retryAsync, isTransientError } from '../../common/retry';
import type { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { redactText } from '../../common/prompt-assembly/redaction';

/**
 * ImageGenMcpServer
 * Handles image generation requests via MCP, now using the standard McpServer base class.
 */
export class ImageGenMcpServer extends Bit {
  private lastRequestByUser: Map<string, number> = new Map();

  constructor() {
    super({
      serviceName: 'image-gen-mcp',
      mcpExposure: 'platform+domain',
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
        const start = Date.now();

        // 0. Rate Limiting (RBAC handled by tool-gateway)
        const userId = (extra as any)?._meta?.userId || (extra as any)?.userId || 'anonymous';
        // MCP is a request/response tool (no event envelope), so prefer a correlationId
        // propagated by the caller via _meta, otherwise generate one. (TA §5.4)
        const correlationId = (extra as any)?._meta?.correlationId || uuidv4();

        this.getLogger().info('Image generation requested', { prompt, aspectRatio, userId, correlationId });

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

            this.logPrompt({
              correlationId,
              prompt,
              response: 'moderation_rejected',
              status: 'rejected',
              model: this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-1' }),
              aspectRatio,
              userId,
              moderation: { flagged: true, categories },
            });

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
          // Default to OpenAI's current image model (gpt-image-1). DALL-E 3 is being
          // decommissioned and the OpenAI image endpoint now rejects the `response_format`
          // parameter that the AI SDK forces for non-gpt-image models, surfacing as
          // "Unknown parameter: 'response_format'.". The model is overridable via config.
          const model = this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-1' });
          const provider = getLlmProvider({
            provider: 'openai',
            model,
            apiKey,
          });

          // Map aspectRatio to a model-appropriate size (AI SDK requirement).
          // gpt-image-* supports 1024x1024 / 1536x1024 / 1024x1536; DALL-E 3 supports
          // 1024x1024 / 1792x1024 / 1024x1792.
          const isGptImage = model.startsWith('gpt-image');
          const landscape = isGptImage ? '1536x1024' : '1792x1024';
          const portrait = isGptImage ? '1024x1536' : '1024x1792';
          const size = aspectRatio === '16:9' ? landscape : (aspectRatio === '9:16' ? portrait : '1024x1024');

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

          // Resolve the image bytes once so retries don't re-encode.
          let imageBuffer: Buffer;
          if (genResult.image.base64) {
            imageBuffer = Buffer.from(genResult.image.base64, 'base64');
          } else if (genResult.image.uint8Array) {
            imageBuffer = Buffer.from(genResult.image.uint8Array);
          } else {
            throw new Error('No image data returned from generation');
          }

          // Upload the image data. Wrap the save in a backoff retry: ADC token fetches
          // against https://www.googleapis.com/oauth2/v4/token intermittently fail with a
          // transient "Premature close" / "socket hang up", which would otherwise surface
          // as a hard persistence failure. Only transient network errors are retried.
          //
          // `resumable: false` forces a simple (all-or-nothing) multipart upload. This is the
          // recommended path for small payloads like a single generated image, and — critically —
          // it avoids the resumable-upload code path, which attaches an `abort-controller`
          // (node polyfill) `signal` to the request. Because the Storage auth transport is now
          // pinned to undici (global `fetch`) to dodge node-fetch's "Premature close" token bug,
          // that foreign signal is rejected by undici with:
          //   RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
          // The simple upload sets no signal, so it round-trips cleanly through undici.
          await retryAsync(
            () =>
              file.save(imageBuffer, {
                resumable: false,
                metadata: { contentType: 'image/png' },
              }),
            {
              attempts: 4,
              baseDelayMs: 250,
              maxDelayMs: 4000,
              shouldRetry: (err, attempt) => {
                const transient = isTransientError(err);
                if (transient) {
                  this.getLogger().warn('GCS upload failed with transient error; retrying', {
                    attempt,
                    error: err?.message,
                  });
                }
                return transient;
              },
            },
          );

          const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
          
          this.getLogger().info('Image persisted to GCS', { publicUrl });

          this.logPrompt({
            correlationId,
            prompt,
            response: publicUrl,
            status: 'success',
            model,
            aspectRatio,
            size,
            userId,
            processingTimeMs: Date.now() - start,
            image: { url: publicUrl, bucket: bucketName, fileName, contentType: 'image/png' },
            moderation: { flagged: false, categories: [] },
          });

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
            ],
          };
        } catch (error: any) {
          this.getLogger().error('Image generation or persistence failed', { error: error, prompt });

          this.logPrompt({
            correlationId,
            prompt,
            response: 'error',
            status: 'error',
            model: this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-1' }),
            aspectRatio,
            userId,
            error: error?.message,
          });

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

  /**
   * Fire-and-forget prompt logging for each generate_image invocation.
   * Mirrors llm-bot / query-analyzer: gated by the existing `llm.promptLogging.enabled`
   * flag, writes to services/image-gen-mcp/prompt_logs/{auto-id}, redacts free-text fields,
   * and never throws into the tool result. (TA §5.5)
   */
  private logPrompt(entry: {
    correlationId: string;
    prompt: string;
    response: string;
    status: 'success' | 'rejected' | 'error';
    model: string;
    aspectRatio: string;
    size?: string;
    userId: string;
    processingTimeMs?: number;
    image?: Record<string, unknown>;
    moderation?: Record<string, unknown>;
    error?: string;
  }) {
    if (!isFeatureEnabled('llm.promptLogging.enabled')) return;
    try {
      const db = getFirestore();
      db.collection('services').doc('image-gen-mcp').collection('prompt_logs').add({
        ...entry,
        prompt: redactText(entry.prompt),
        response: redactText(entry.response),
        error: entry.error ? redactText(entry.error) : undefined,
        platform: 'openai',
        createdAt: new Date(),
      }).catch((e: any) =>
        this.getLogger().warn('image_gen_mcp.prompt_logging_failed', {
          correlationId: entry.correlationId,
          error: e?.message,
        }));
    } catch (e: any) {
      this.getLogger().warn('image_gen_mcp.prompt_logging_failed', {
        correlationId: entry.correlationId,
        error: e?.message,
      });
    }
  }
}

if (require.main === module) {
  const server = new ImageGenMcpServer();
  const cfg = server.getConfig();
  server.start(cfg.port).catch((err) => {
    console.error('Failed to start image-gen-mcp:', err);
    process.exit(1);
  });
}
