import type { Logger } from '../orchestration/logger';
import type { IDocumentStore } from '../../../../src/common/persistence/interfaces.js';
import { RegistryEntry, RegistryReader } from './types';

/**
 * PostgreSQL-backed {@link RegistryReader}.
 *
 * Reads the `service_registry` table (PostgreSQL equivalent of Firestore's `mcp_servers`)
 * for Bit discovery. Provides name/profile/exposure and resolves self-published MCP URLs.
 */
export class PostgresRegistryReader implements RegistryReader {
  constructor(
    private readonly store: IDocumentStore,
    private readonly logger?: Logger,
  ) {}

  async listServers(): Promise<RegistryEntry[]> {
    try {
      // Query all active services from service_registry
      const docs = await this.store.query('service_registry', {
        filters: [
          { field: 'status', operator: '==', value: 'active' }
        ]
      });

      const entries: RegistryEntry[] = docs.map((d: any) => ({
        name: d.name || d.id,
        url: d.url,
        profile: d.profile,
        exposure: d.exposure || d.mcpExposure,
        transport: d.transport,
        discoverySource: d.discoverySource,
      }));

      this.logger?.info(
        { action: 'fleet.registry.read', count: entries.length },
        `Read ${entries.length} Bit(s) from service_registry (PostgreSQL)`
      );

      return entries;
    } catch (error: any) {
      this.logger?.error(
        { action: 'fleet.registry.read', error: error.message },
        'Failed to read service_registry from PostgreSQL'
      );
      throw error;
    }
  }
}
