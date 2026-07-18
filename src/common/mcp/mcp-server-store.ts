import type { Firestore } from '@google-cloud/firestore';
import type { IDocumentStore } from '../persistence/interfaces';
import { McpServerConfig } from './types';

/**
 * MCP server registration document stored in Firestore or PostgreSQL.
 */
export interface McpServerDocument {
  name: string;
  transport?: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  status?: 'active' | 'inactive';
  createdAt?: string;
  updatedAt: string;
  discoverySource: string;
  correlationId: string;
  [key: string]: any; // Allow additional payload fields
}

/**
 * Interface for MCP server registry storage operations.
 */
export interface IMcpServerStore {
  /**
   * Upsert an MCP server registration.
   * @param name - Server name (document ID)
   * @param data - Server registration data
   */
  upsert(name: string, data: McpServerDocument): Promise<void>;

  /**
   * Watch for changes to MCP server registrations.
   * @param callback - Called when server configs change
   * @returns Unsubscribe function
   */
  watch(callback: (configs: McpServerConfig[]) => void): () => void;
}

/**
 * Firestore implementation of MCP server store.
 */
export class FirestoreMcpServerStore implements IMcpServerStore {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionName: string = 'mcp_servers'
  ) {}

  async upsert(name: string, data: McpServerDocument): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(name).set(data, { merge: true });
  }

  watch(callback: (configs: McpServerConfig[]) => void): () => void {
    return this.firestore.collection(this.collectionName).onSnapshot((snapshot) => {
      const configs: McpServerConfig[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data && Object.keys(data).length > 0) {
          configs.push({ ...data, name: data.name || doc.id } as McpServerConfig);
        }
      });
      callback(configs);
    }, (error) => {
      console.error('FirestoreMcpServerStore watch error:', error);
    });
  }
}

/**
 * PostgreSQL implementation of MCP server store via IDocumentStore.
 */
export class DocumentStoreMcpServerStore implements IMcpServerStore {
  constructor(
    private readonly store: IDocumentStore,
    private readonly tableName: string = 'service_registry'
  ) {}

  async upsert(name: string, data: McpServerDocument): Promise<void> {
    await this.store.set(this.tableName, name, data);
  }

  watch(callback: (configs: McpServerConfig[]) => void): () => void {
    return this.store.watch<McpServerConfig>(
      this.tableName,
      (configs: McpServerConfig[]) => {
        // Filter out empty/invalid configs
        const validConfigs = configs.filter((c: McpServerConfig) => c && Object.keys(c).length > 0);
        callback(validConfigs);
      },
      5000 // 5 second polling interval
    );
  }
}

/**
 * In-memory mock store for test environments
 */
class InMemoryMcpServerStore implements IMcpServerStore {
  private data = new Map<string, McpServerDocument>();

  async upsert(name: string, data: McpServerDocument): Promise<void> {
    this.data.set(name, data);
  }

  watch(callback: (configs: McpServerConfig[]) => void): () => void {
    // Immediate callback with current state
    const configs = Array.from(this.data.values()).map(d => ({ ...d } as McpServerConfig));
    callback(configs);
    // Return no-op unsubscribe
    return () => {};
  }
}

/**
 * Factory function to create MCP server store based on backend detection.
 * Returns in-memory mock store if no database provided (test environment).
 */
export function createMcpServerStore(
  dbOrStore: any,
  collectionOrTable?: string
): IMcpServerStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreMcpServerStore(dbOrStore, collectionOrTable || 'mcp_servers');
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreMcpServerStore(dbOrStore, collectionOrTable || 'service_registry');
  }

  // Test environment: return in-memory mock store
  return new InMemoryMcpServerStore();
}
