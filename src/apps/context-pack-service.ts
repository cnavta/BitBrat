import { Bit } from '../common/base-server';
import {
  INTERNAL_MCP_REGISTRATION_V1,
  INTERNAL_CONTEXT_V1,
  InternalEventV2,
  AnnotationV1
} from '../types/events';
import {
  StaticContextProvider,
  packsToNamedContexts,
  type ContextPack
} from '../common/context';
import { getFirestore } from '../common/firebase';
import { embedText, buildEmbeddingText } from '../common/context/embedding';
import type { NamedContext } from '../common/prompt-assembly/types';
import crypto from 'crypto';

/**
 * ContextPackServer (Sprint 338: P4 RAG Scale-Out)
 *
 * Analysis-stage service that enriches events with semantically relevant context packs
 * via RAG (Retrieval-Augmented Generation). Sits between query-analyzer and event-router
 * in the analysis routing slip.
 *
 * Flow:
 * 1. Listens to INTERNAL_MCP_REGISTRATION_V1 to aggregate context providers from Bits
 * 2. Listens to INTERNAL_CONTEXT_V1 for main processing
 * 3. Extracts userQuery from event.message.text
 * 4. Resolves semantically relevant context packs via Firestore Vector Search
 * 5. Adds resolved packs as annotations (kind='context', source='context-pack')
 * 6. Calls next() to continue routing slip
 *
 * Profile: core
 * MCP Exposure: platform-only
 * Kind: pipeline-service
 */
export class ContextPackServer extends Bit {
  // Aggregated context providers from registered Bits (mirroring tool-gateway pattern)
  private contextProviders: Map<string, StaticContextProvider> = new Map();

  constructor() {
    super({ mcpExposure: 'platform-only' });
  }

  async start(port?: number): Promise<void> {
    // Aggregate context providers from MCP registrations
    await this.onMessage({
      destination: INTERNAL_MCP_REGISTRATION_V1,
      queue: 'context-pack',
      ack: 'explicit'
    }, async (event: InternalEventV2, _attributes, ctx) => {
      try {
        await this.handleMcpRegistration(event);
        await ctx.ack();
      } catch (err) {
        this.getLogger().error('context_pack.registration_error', {
          correlationId: event.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
        await ctx.ack(); // Ack even on error to prevent redelivery loop
      }
    });

    // Main handler: enrich events with context packs
    await this.onMessage({
      destination: INTERNAL_CONTEXT_V1,
      queue: 'context-pack',
      ack: 'explicit'
    }, async (event: InternalEventV2, _attributes, ctx) => {
      try {
        await this.enrichContextPacks(event);
        await this.next(event, 'OK');
        await ctx.ack();
      } catch (err) {
        this.getLogger().error('context_pack.handler_error', {
          correlationId: event.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
        await ctx.ack(); // Ack even on error to prevent redelivery loop
      }
    });

    return super.start(port || parseInt(process.env.PORT || '3000', 10));
  }

  /**
   * Handle MCP registration events by aggregating context providers and upserting packs to Firestore.
   * Mirrors tool-gateway's registration handling (BL-338-201/202).
   */
  private async handleMcpRegistration(event: InternalEventV2) {
    const payload = event.payload;
    if (!payload || !payload.name) {
      this.getLogger().warn('context_pack.registration.invalid_payload', {
        correlationId: event.correlationId
      });
      return;
    }

    const ctx = (payload as any).context;
    if (!ctx || (!Array.isArray(ctx.packs) && !Array.isArray(ctx.bindings))) {
      // No context advertised (back-compat with older Bits)
      return;
    }

    // Store provider for resolution
    this.contextProviders.set(
      payload.name,
      new StaticContextProvider(ctx.packs || [], ctx.bindings || [])
    );

    this.getLogger().info('context_pack.provider.registered', {
      name: payload.name,
      packs: (ctx.packs || []).length,
      bindings: (ctx.bindings || []).length,
    });

    // Upsert packs to Firestore with embeddings (for RAG)
    if (Array.isArray(ctx.packs) && ctx.packs.length > 0) {
      await this.upsertContextPacks(payload.name, ctx.packs);
    }
  }

  /**
   * Upsert context packs to Firestore context_packs collection with embeddings.
   * Reuses BL-338-201/202 embedding generation logic.
   */
  private async upsertContextPacks(bitName: string, packs: ContextPack[]) {
    const db = getFirestore();
    const col = db.collection('context_packs');

    for (const pack of packs) {
      try {
        const embeddingText = buildEmbeddingText(pack);
        const embedding = await embedText(embeddingText);

        const packDoc: any = {
          id: pack.id,
          version: pack.version,
          title: pack.title,
          priority: pack.priority,
          format: pack.format,
          body: typeof pack.body === 'string' ? pack.body : JSON.stringify(pack.body),
          source: pack.source,
          bitName,
          active: true,
          updatedAt: new Date().toISOString(),
        };

        if (embedding) {
          packDoc.embedding = embedding;
          packDoc.embeddingText = embeddingText;
        }

        await col.doc(pack.id).set(packDoc, { merge: true });

        this.getLogger().info('context_pack.upserted', {
          packId: pack.id,
          bitName,
          embeddingGenerated: !!embedding,
        });
      } catch (err) {
        this.getLogger().warn('context_pack.upsert_failed', {
          packId: pack.id,
          bitName,
          error: err instanceof Error ? err.message : String(err),
        });
        // Non-fatal: continue with other packs
      }
    }
  }

  /**
   * Main enrichment handler: resolve semantically relevant context packs via RAG
   * and add them as annotations.
   */
  private async enrichContextPacks(event: InternalEventV2) {
    const userQuery = event.message?.text;

    if (!userQuery) {
      this.getLogger().debug('context_pack.skip_no_query', {
        correlationId: event.correlationId,
      });
      return;
    }

    // Resolve context packs via RAG
    const contexts = await this.resolveViaRAG(userQuery, event.type);

    if (contexts.length === 0) {
      this.getLogger().debug('context_pack.no_packs_resolved', {
        correlationId: event.correlationId,
        querySnippet: userQuery.slice(0, 50),
      });
      return;
    }

    // Add as annotations
    if (!Array.isArray(event.annotations)) {
      event.annotations = [];
    }

    for (const context of contexts) {
      const annotation: AnnotationV1 = {
        id: crypto.randomUUID(),
        kind: 'context',
        source: 'context-pack',
        createdAt: new Date().toISOString(),
        label: context.name,
        payload: {
          packId: this.extractPackId(context.subheader),
          content: context.content,
          priority: context.priority,
          subheader: context.subheader,
        },
      };

      event.annotations.push(annotation);
    }

    this.getLogger().info('context_pack.enriched', {
      correlationId: event.correlationId,
      packCount: contexts.length,
      querySnippet: userQuery.slice(0, 50),
    });
  }

  /**
   * Resolve context packs via RAG using VectorContextProvider.
   * Pure semantic retrieval (no tool bindings at analysis stage).
   */
  private async resolveViaRAG(
    semanticQuery: string,
    eventType: string
  ): Promise<NamedContext[]> {
    if (!this.isRagEnabled()) {
      return [];
    }

    const startMs = Date.now();

    try {
      const { VectorContextProvider } = await import('../common/context/vector-provider');
      const maxResults = parseInt(this.getConfig('RAG_CONTEXT_MAX_RESULTS', { default: '5' }), 10);
      const minSimilarity = parseFloat(this.getConfig('RAG_CONTEXT_MIN_SIMILARITY', { default: '0.7' }));
      const timeout = parseInt(this.getConfig('RAG_CONTEXT_TIMEOUT_MS', { default: '200' }), 10);

      const vectorProvider = new VectorContextProvider(semanticQuery, {
        maxResults,
        minSimilarity,
        timeout,
      });

      const packs = await vectorProvider.listPacks();
      const contexts = packsToNamedContexts(packs);

      const latencyMs = Date.now() - startMs;
      this.getLogger().info('context_pack.rag_resolved', {
        packCount: packs.length,
        querySnippet: semanticQuery.slice(0, 50),
        latencyMs,
      });

      return contexts;
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      this.getLogger().warn('context_pack.rag_failed', {
        error: err instanceof Error ? err.message : String(err),
        latencyMs,
        querySnippet: semanticQuery.slice(0, 50),
      });
      // Non-fatal: return empty array
      return [];
    }
  }

  /**
   * Check if RAG context augmentation is enabled via feature flag.
   */
  private isRagEnabled(): boolean {
    try {
      return this.getConfig('RAG_CONTEXT_ENABLED', { default: 'false' }).toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Extract pack ID from subheader (format: "packId vX (source: ...)")
   */
  private extractPackId(subheader?: string): string | null {
    if (!subheader) return null;
    const match = /^(\S+) v\S+/.exec(subheader);
    return match ? match[1] : null;
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new ContextPackServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start context-pack:', err);
    process.exit(1);
  });
}
