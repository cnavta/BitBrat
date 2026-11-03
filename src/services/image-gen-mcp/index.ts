import { Request, Response } from 'express';
import { Bit } from '../../common/base-server';
import OpenAI from 'openai';
import { NewStorageManager } from '../../common/resources/storage-manager';
import type { IStorageDriver } from '../../common/storage/types';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getFirestore } from '../../common/firebase';
import { isFeatureEnabled } from '../../common/feature-flags';
import { redactText } from '../../common/prompt-assembly/redaction';
import { createPromptLogStore, type IPromptLogStore } from '../query-analyzer/llm-provider';
import type { IDocumentStore } from '../../common/persistence/interfaces';

/**
 * ImageGenMcpServer
 * Handles image generation requests via MCP, now using the standard McpServer base class.
 */
export class ImageGenMcpServer extends Bit {
  private lastRequestByUser: Map<string, number> = new Map();
  private promptLogStore: IPromptLogStore;

  constructor() {
    super({
      serviceName: 'image-gen-mcp',
      mcpExposure: 'platform+domain',
      healthPaths: ['/health'],
      resources: {
        storage: new NewStorageManager(),
      },
    });

    // Initialize prompt log store (uses factory for backend auto-detection)
    // Get Firestore or PostgreSQL document store from BaseServer resources
    const dbOrStore = this.getResource<any>('firestore') || this.getResource<IDocumentStore>('documentStore');
    this.promptLogStore = createPromptLogStore(dbOrStore, 'image-gen-mcp');

    this.setupMcpTools();
  }

  private setupMcpTools() {
    this.registerTool(
      'generate_image',
      'Generate an image based on a prompt using GPT Image 2.5 and persist it to storage.',
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
              model: this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-2.5-sunburst' }),
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
          // Use OpenAI SDK directly to avoid the AI SDK's response_format parameter issue.
          // GPT Image 2.5 models (gpt-image-2.5-sunburst, gpt-image-2.5-flare) do not accept
          // the response_format parameter and always return base64-encoded images.
          // DALL-E 2 and DALL-E 3 were deprecated on May 12, 2026.
          const model = this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-2.5-sunburst' });

          // Map aspectRatio to appropriate size for GPT Image models
          // GPT Image supports: 1024x1024, 1536x1024, 1024x1536
          const landscape = '1536x1024';
          const portrait = '1024x1536';
          const size = aspectRatio === '16:9' ? landscape : (aspectRatio === '9:16' ? portrait : '1024x1024');

          // Create OpenAI client and generate image
          const openai = new OpenAI({ apiKey });

          this.getLogger().debug('Generating image with OpenAI SDK', { model, size, prompt: prompt.substring(0, 100) });

          // GPT Image 2.5 models do NOT accept response_format parameter and always return base64
          const genResult = await openai.images.generate({
            model,
            prompt,
            size: size as '1024x1024' | '1536x1024' | '1024x1536',
            n: 1,
          });

          this.getLogger().info('Image generated successfully, preparing storage upload');

          // 3. Persist to storage (BL-005)
          const storageDriver = this.getResource<IStorageDriver>('storage');
          if (!storageDriver) {
            throw new Error('Storage driver not initialized');
          }

          const fileName = `${uuidv4()}.png`;

          // Extract image data from OpenAI SDK response
          if (!genResult.data || genResult.data.length === 0) {
            throw new Error('No image data returned from generation');
          }

          const imageData = genResult.data[0];
          if (!imageData || !imageData.b64_json) {
            throw new Error('No image data returned from generation');
          }

          const imageBuffer = Buffer.from(imageData.b64_json, 'base64');

          // Upload using storage driver abstraction
          // The driver handles retries internally (GCS driver has built-in retry logic)
          const uploadResult = await storageDriver.upload(imageBuffer, fileName, {
            contentType: 'image/png',
            size: imageBuffer.length,
            createdAt: new Date().toISOString(),
            customMetadata: {
              userId,
              correlationId,
              prompt: redactText(prompt),
              aspectRatio,
              model,
            },
          });

          const publicUrl = uploadResult.publicUrl;

          this.getLogger().info('Image persisted to storage', {
            publicUrl,
            driver: storageDriver.name,
            fileName: uploadResult.fileName,
          });

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
            image: {
              url: publicUrl,
              fileName: uploadResult.fileName,
              size: uploadResult.size,
              uploadedAt: uploadResult.uploadedAt,
              driver: storageDriver.name,
              contentType: 'image/png',
            },
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
          // Extract error details for better logging
          const errorMessage = error?.message || String(error);
          const errorCode = error?.code;
          const errorDetails = error?.errors?.[0]?.message;

          this.getLogger().error('Image generation or persistence failed', {
            errorMessage,
            errorCode,
            errorDetails,
            errorType: error?.constructor?.name,
            prompt
          });

          this.logPrompt({
            correlationId,
            prompt,
            response: 'error',
            status: 'error',
            model: this.getConfig('IMAGE_GEN_MODEL', { default: 'gpt-image-2.5-sunburst' }),
            aspectRatio,
            userId,
            error: errorMessage,
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
      // Use the shared prompt log store abstraction
      // Note: PromptLogRecord expects 'entities' and 'topic' fields, which image-gen doesn't have.
      // We'll provide empty defaults and extend the record with image-gen-specific fields.
      const logRecord: any = {
        correlationId: entry.correlationId,
        prompt: redactText(entry.prompt),
        response: redactText(entry.response),
        entities: [], // Not applicable for image generation
        topic: 'image_generation', // Static topic for image generation
        platform: 'openai',
        model: entry.model,
        processingTimeMs: entry.processingTimeMs || 0,
        createdAt: new Date(),
        // Image-gen-specific fields (stored in JSONB, no schema conflict)
        status: entry.status,
        aspectRatio: entry.aspectRatio,
        size: entry.size,
        userId: entry.userId,
        image: entry.image,
        moderation: entry.moderation,
        error: entry.error ? redactText(entry.error) : undefined,
      };

      this.promptLogStore.log(logRecord).catch((e: any) =>
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
