import { getFirestore } from '../firebase';
import { metrics } from '@opentelemetry/api';
import { ToolExecutionContext } from '../../types/tools';
import type { IDocumentStore } from '../persistence/interfaces';

// =============================================================================
// Tool Usage Store Abstraction
// =============================================================================

/**
 * Interface for tool usage audit logging.
 * Supports both Firestore and PostgreSQL via IDocumentStore.
 */
export interface IToolUsageStore {
  /**
   * Record a tool usage event (fire-and-forget).
   * @param record - Tool usage record
   */
  record(record: ToolUsageRecord): Promise<void>;
}

/**
 * Tool usage record structure.
 */
export interface ToolUsageRecord {
  ts: string;
  userId: string | null;
  agent: string;
  tool: string;
  server: string;
  durationMs: number;
  status: 'OK' | 'ERROR';
  errorCode: string | null;
  correlationId: string | null;
}

/**
 * Firestore-based tool usage store implementation.
 */
export class FirestoreToolUsageStore implements IToolUsageStore {
  private db: FirebaseFirestore.Firestore;
  private collectionName: string;

  constructor(db?: FirebaseFirestore.Firestore, collectionName = 'tool_usage') {
    this.db = db || getFirestore();
    this.collectionName = collectionName;
  }

  async record(record: ToolUsageRecord): Promise<void> {
    await this.db.collection(this.collectionName).add(record);
  }
}

/**
 * PostgreSQL-based tool usage store implementation via IDocumentStore.
 */
export class DocumentStoreToolUsageStore implements IToolUsageStore {
  constructor(
    private readonly store: IDocumentStore,
    private readonly tableName = 'tool_usage'
  ) {}

  async record(record: ToolUsageRecord): Promise<void> {
    // Generate a unique ID for the record
    const id = `${record.server}_${record.tool}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.store.set(this.tableName, id, record);
  }
}

/**
 * Factory function to create tool usage store based on backend detection.
 *
 * @param dbOrStore - Optional Firestore instance or IDocumentStore
 * @param collectionOrTable - Collection name (Firestore) or table name (PostgreSQL)
 * @returns IToolUsageStore implementation
 */
export function createToolUsageStore(
  dbOrStore?: any,
  collectionOrTable?: string
): IToolUsageStore {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreToolUsageStore(dbOrStore, collectionOrTable || 'tool_usage');
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreToolUsageStore(dbOrStore, collectionOrTable || 'tool_usage');
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createToolUsageStore: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Default to Firestore
  return new FirestoreToolUsageStore(undefined, collectionOrTable || 'tool_usage');
}

export class McpObservability {
  private static meter = metrics.getMeter('mcp-gateway');

  private static toolCalls = McpObservability.meter.createCounter('mcp.gateway.tool_calls_total', {
    description: 'Total number of tool calls',
  });

  private static toolDuration = McpObservability.meter.createHistogram('mcp.gateway.tool_call_duration_ms', {
    description: 'Duration of tool calls in ms',
    unit: 'ms',
  });

  private static errors = McpObservability.meter.createCounter('mcp.gateway.errors_total', {
    description: 'Total number of errors',
  });

  // Track number of pending writes to prevent overwhelming the connection pool
  private static pendingWrites = 0;
  private static readonly MAX_PENDING_WRITES = 100;

  // Tool usage store (lazy-initialized to allow mocking in tests)
  private static toolUsageStore: IToolUsageStore | null = null;

  /**
   * Get or create the tool usage store (lazy initialization).
   */
  private static getToolUsageStore(): IToolUsageStore {
    if (!McpObservability.toolUsageStore) {
      McpObservability.toolUsageStore = createToolUsageStore();
    }
    return McpObservability.toolUsageStore;
  }

  /**
   * Set the tool usage store (useful for testing or switching backends).
   * @param store - IToolUsageStore implementation
   */
  static setToolUsageStore(store: IToolUsageStore) {
    McpObservability.toolUsageStore = store;
  }

  /**
   * Records tool usage to Firestore and OTel metrics.
   */
  static async recordCall(
    serverName: string,
    toolName: string,
    durationMs: number,
    error: boolean,
    context?: ToolExecutionContext,
    errorObj?: any
  ) {
    const labels = {
      server: serverName,
      tool: toolName,
      status: error ? 'error' : 'success',
      agent: context?.agentName || 'unknown',
    };

    // OTel Metrics
    this.toolCalls.add(1, labels);
    this.toolDuration.record(durationMs, labels);
    if (error) {
      this.errors.add(1, { ...labels, code: errorObj?.code || 'UNKNOWN' });
    }

    // Audit Log (tool_usage) - Firestore or PostgreSQL
    // Fire-and-forget with timeout to prevent blocking the event loop
    // if persistence is slow/crashed (avoids cascading failures)

    // Backpressure: Drop writes if too many are already pending
    if (McpObservability.pendingWrites >= McpObservability.MAX_PENDING_WRITES) {
      console.warn(`Dropping tool_usage write: ${McpObservability.pendingWrites} pending writes (max ${McpObservability.MAX_PENDING_WRITES})`);
      return;
    }

    McpObservability.pendingWrites++;

    const writePromise = (async () => {
      try {
        const record: ToolUsageRecord = {
          ts: new Date().toISOString(),
          userId: context?.userId || null,
          agent: context?.agentName || 'unknown',
          tool: toolName,
          server: serverName,
          durationMs,
          status: error ? 'ERROR' : 'OK',
          errorCode: error ? (errorObj?.code || errorObj?.message || 'UNKNOWN') : null,
          correlationId: context?.correlationId || null,
        };

        const storeWritePromise = McpObservability.getToolUsageStore().record(record);

        // Race against 5-second timeout to prevent blocking
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tool usage write timeout (5s)')), 5000)
        );

        await Promise.race([storeWritePromise, timeoutPromise]);
      } catch (e: any) {
        // Don't fail the tool call if audit logging fails, just log it
        console.error('Failed to write to tool_usage:', e?.message || String(e));
      } finally {
        McpObservability.pendingWrites--;
      }
    })();

    // Don't await - let it complete in background
    // Unhandled rejections are caught by the inner try-catch
    writePromise.catch(() => {});  // Suppress unhandled rejection warnings
  }
}
