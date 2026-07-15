import { getFirestore } from '../firebase';
import { metrics } from '@opentelemetry/api';
import { ToolExecutionContext } from '../../types/tools';

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

  // Track number of pending Firestore writes to prevent overwhelming the connection pool
  private static pendingFirestoreWrites = 0;
  private static readonly MAX_PENDING_WRITES = 100;

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

    // Firestore Audit Log (tool_usage)
    // Fire-and-forget with timeout to prevent blocking the event loop
    // if Firestore is slow/crashed (avoids cascading failures)

    // Backpressure: Drop writes if too many are already pending
    if (McpObservability.pendingFirestoreWrites >= McpObservability.MAX_PENDING_WRITES) {
      console.warn(`Dropping tool_usage write: ${McpObservability.pendingFirestoreWrites} pending writes (max ${McpObservability.MAX_PENDING_WRITES})`);
      return;
    }

    McpObservability.pendingFirestoreWrites++;

    const firestoreWritePromise = (async () => {
      try {
        const db = getFirestore();
        const writePromise = db.collection('tool_usage').add({
          ts: new Date().toISOString(),
          userId: context?.userId || null,
          agent: context?.agentName || 'unknown',
          tool: toolName,
          server: serverName,
          durationMs,
          status: error ? 'ERROR' : 'OK',
          errorCode: error ? (errorObj?.code || errorObj?.message || 'UNKNOWN') : null,
          correlationId: context?.correlationId || null,
        });

        // Race against 5-second timeout to prevent blocking
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firestore write timeout (5s)')), 5000)
        );

        await Promise.race([writePromise, timeoutPromise]);
      } catch (e: any) {
        // Don't fail the tool call if audit logging fails, just log it
        console.error('Failed to write to tool_usage collection:', e?.message || String(e));
      } finally {
        McpObservability.pendingFirestoreWrites--;
      }
    })();

    // Don't await - let it complete in background
    // Unhandled rejections are caught by the inner try-catch
    firestoreWritePromise.catch(() => {});  // Suppress unhandled rejection warnings
  }
}
