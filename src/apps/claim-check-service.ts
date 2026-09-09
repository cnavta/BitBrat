import { Bit } from '../common/base-server';
import { ClaimCheckService } from '../services/claim-check/claim-check-service';
import type { InternalEventV2, PersistenceSnapshotEventV1 } from '../types';
import { z } from 'zod';

/**
 * ClaimCheckServer - Redis-backed temporary event and blob storage
 * Sprint 24: Claim Check Bit Implementation
 *
 * Provides claim check pattern for:
 * 1. Event storage - Store successfully persisted events by correlationId
 * 2. Blob storage - Store large binary/multi-modal content with generated IDs
 *
 * Subscribes to:
 * - internal.persistence.snapshot.v1 (stores final snapshots)
 *
 * MCP Tools (platform-only):
 * - claim.event.retrieve - Retrieve event by correlationId
 * - claim.event.exists - Check if event claim exists
 * - claim.blob.store - Store blob and get blobId
 * - claim.blob.retrieve - Retrieve blob by blobId
 * - claim.blob.exists - Check if blob claim exists
 *
 * Profile: core
 * MCP Exposure: platform-only
 * Kind: pipeline-service
 */
export class ClaimCheckServer extends Bit {
  private claimService?: ClaimCheckService;
  private setupComplete = false;

  constructor() {
    super({
      mcpExposure: 'platform-only',
    });

    // Register setup to run on startup
    this.onStartup(async () => {
      await this.setup();
    });
  }

  /**
   * Lazy initialization of ClaimCheckService
   * Only initializes once, returns existing instance on subsequent calls
   */
  private ensureClaimService(): ClaimCheckService | null {
    if (this.claimService) {
      return this.claimService;
    }

    // Access Redis resource directly from this.resources (set by base server)
    const redis = (this as any).resources?.redis;

    if (!redis) {
      // Redis not ready yet - this is normal during early startup
      return null;
    }

    // Initialize service now that Redis is available
    this.claimService = new ClaimCheckService(
      redis,
      this.getConfig(),
      this.getLogger()
    );
    this.getLogger().info('claim_check.setup.service_initialized');

    return this.claimService;
  }

  private async setup(): Promise<void> {
    // Setup subscriptions and tools
    // ClaimCheckService will be lazily initialized when first needed
    await this.setupSubscriptions();
    this.registerTools();
    this.setupComplete = true;
  }

  /**
   * Setup message subscriptions
   * Subscribes to persistence snapshots and stores ALL snapshots in Redis (Sprint 24)
   */
  private async setupSubscriptions(): Promise<void> {
    // Subscribe to persistence snapshots
    await this.onMessage<PersistenceSnapshotEventV1>(
      'internal.persistence.snapshot.v1',
      async (snapshot, _attrs, ctx) => {
        // Sprint 24: Accept ALL snapshot kinds (no filtering!)
        // Versioning logic in ClaimCheckService handles out-of-order delivery

        // Lazy initialize claim service (will return null if Redis not ready)
        const claimService = this.ensureClaimService();
        if (!claimService) {
          await ctx.ack();
          return;
        }

        try {
          // Sprint 24: Pass full snapshot to service for versioning
          const result = await claimService.storeEventClaim(snapshot);

          // Log result based on versioning outcome
          if (result === 'stored') {
            this.getLogger().debug('claim_check.snapshot.stored', {
              correlationId: snapshot.correlationId,
              kind: snapshot.kind,
              sourceService: snapshot.sourceService,
              sourceTopic: snapshot.sourceTopic,
              capturedAt: snapshot.capturedAt,
            });
          } else if (result === 'rejected_stale') {
            this.getLogger().debug('claim_check.snapshot.rejected_stale', {
              correlationId: snapshot.correlationId,
              kind: snapshot.kind,
              capturedAt: snapshot.capturedAt,
              reason: 'Incoming snapshot is older than stored version',
            });
          } else if (result === 'rejected_error') {
            this.getLogger().warn('claim_check.snapshot.rejected_error', {
              correlationId: snapshot.correlationId,
              kind: snapshot.kind,
              reason: 'Size limit exceeded or Redis error',
            });
          }
        } catch (error: any) {
          // Log error but don't crash - fail-open pattern
          this.getLogger().error('claim_check.snapshot.store_failed', {
            correlationId: snapshot.correlationId,
            kind: snapshot.kind,
            sourceService: snapshot.sourceService,
            error: error.message,
          });
        } finally {
          // Always ack to prevent retry loops
          await ctx.ack();
        }
      }
    );

    this.getLogger().info('claim_check.subscriptions.initialized');
  }

  /**
   * Register MCP tools for event claim check
   * Provides platform-only tools for retrieving and checking event claims
   */
  private registerTools(): void {
    // claim.event.retrieve - Retrieve event by correlationId (Sprint 24: Returns versioned snapshot)
    this.registerTool(
      'claim.event.retrieve',
      'Retrieve a stored event snapshot with versioning metadata by correlation ID',
      z.object({
        correlationId: z.string().describe('Correlation ID of the event to retrieve'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: 'Claim check service not available (Redis unavailable)' }],
            isError: true,
          };
        }

        try {
          // Sprint 24: Returns StoredSnapshot with versioning metadata
          const snapshot = await claimService.retrieveEventClaim(args.correlationId);

          if (!snapshot) {
            return {
              content: [{ type: 'text', text: 'Event not found or expired' }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.retrieve.error', {
            correlationId: args.correlationId,
            error: error.message,
          });
          return {
            content: [{ type: 'text', text: `Error retrieving event: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // claim.event.status - Get snapshot metadata without full event payload (Sprint 24)
    this.registerTool(
      'claim.event.status',
      'Get snapshot metadata (kind, capturedAt, sourceService, etc.) without retrieving the full event payload',
      z.object({
        correlationId: z.string().describe('Correlation ID to check'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, reason: 'Service unavailable' }, null, 2) }],
          };
        }

        try {
          const snapshot = await claimService.retrieveEventClaim(args.correlationId);

          if (!snapshot) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ exists: false }, null, 2) }],
            };
          }

          // Return metadata only (no event payload)
          const status = {
            exists: true,
            kind: snapshot.kind,
            capturedAt: snapshot.capturedAt,
            sourceService: snapshot.sourceService,
            sourceTopic: snapshot.sourceTopic,
            sequence: snapshot.sequence,
            updatedAt: snapshot.updatedAt,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.status.error', {
            correlationId: args.correlationId,
            error: error.message,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }
    );

    // claim.event.exists - Check if event claim exists
    this.registerTool(
      'claim.event.exists',
      'Check if an event claim exists in storage by correlation ID',
      z.object({
        correlationId: z.string().describe('Correlation ID to check'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, reason: 'Service unavailable' }, null, 2) }],
          };
        }

        try {
          const exists = await claimService.eventClaimExists(args.correlationId);

          return {
            content: [{ type: 'text', text: JSON.stringify({ exists }, null, 2) }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.exists.error', {
            correlationId: args.correlationId,
            error: error.message,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }
    );

    // claim.blob.store - Store blob with base64 data
    this.registerTool(
      'claim.blob.store',
      'Store a blob (binary data) in temporary storage and get a claim ID',
      z.object({
        data: z.string().describe('Base64-encoded blob data'),
        contentType: z.string().optional().describe('MIME type (e.g., image/png, video/mp4)'),
        ttl: z.number().optional().describe('Time-to-live in seconds (default: 300, max: 3600)'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: 'Claim check service not available (Redis unavailable)' }],
            isError: true,
          };
        }

        try {
          // Decode base64 to buffer
          const buffer = Buffer.from(args.data, 'base64');

          // Store blob
          const result = await claimService.storeBlobClaim(buffer, {
            contentType: args.contentType,
            ttl: args.ttl,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.blob_store.error', {
            error: error.message,
            contentType: args.contentType,
          });
          return {
            content: [{ type: 'text', text: `Error storing blob: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // claim.blob.retrieve - Retrieve blob by ID
    this.registerTool(
      'claim.blob.retrieve',
      'Retrieve a stored blob by its claim ID',
      z.object({
        blobId: z.string().describe('Blob claim ID to retrieve'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: 'Claim check service not available (Redis unavailable)' }],
            isError: true,
          };
        }

        try {
          const result = await claimService.retrieveBlobClaim(args.blobId);

          if (!result) {
            return {
              content: [{ type: 'text', text: 'Blob not found or expired' }],
              isError: true,
            };
          }

          // Encode data to base64
          const base64Data = result.data.toString('base64');

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                blobId: args.blobId,
                contentType: result.contentType,
                size: result.metadata.size,
                data: base64Data,
                expiresAt: result.metadata.expiresAt,
              }, null, 2)
            }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.blob_retrieve.error', {
            blobId: args.blobId,
            error: error.message,
          });
          return {
            content: [{ type: 'text', text: `Error retrieving blob: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // claim.blob.exists - Check if blob exists
    this.registerTool(
      'claim.blob.exists',
      'Check if a blob claim exists in storage by ID',
      z.object({
        blobId: z.string().describe('Blob claim ID to check'),
      }),
      async (args) => {
        const claimService = this.ensureClaimService();
        if (!claimService) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, reason: 'Service unavailable' }, null, 2) }],
          };
        }

        try {
          const exists = await claimService.blobClaimExists(args.blobId);

          return {
            content: [{ type: 'text', text: JSON.stringify({ exists }, null, 2) }],
          };
        } catch (error: any) {
          this.getLogger().error('claim_check.tool.blob_exists.error', {
            blobId: args.blobId,
            error: error.message,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ exists: false, error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }
    );

    this.getLogger().info('claim_check.tools.registered', {
      tools: [
        'claim.event.retrieve',
        'claim.event.status',
        'claim.event.exists',
        'claim.blob.store',
        'claim.blob.retrieve',
        'claim.blob.exists',
      ],
    });
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new ClaimCheckServer();
  const port = parseInt(process.env.PORT || '3008', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start claim-check:', err);
    process.exit(1);
  });
}
