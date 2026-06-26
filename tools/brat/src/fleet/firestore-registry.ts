import type { Logger } from '../orchestration/logger';
import { getBackupFirestore, FirestoreConnectOptions } from '../providers/gcp/firestore';
import { RegistryEntry, RegistryReader } from './types';

/**
 * BL-204 §4.3 / §8 — Firestore-backed {@link RegistryReader}.
 *
 * Reads the live `mcp_servers` collection (the same source `RegistryWatcher` uses) so discovery can
 * render `name/profile/exposure` and resolve a Bit's self-published external MCP URL. The URL is the
 * registry-published value (Cloud Run URL / compose host / `ssh://`-resolved host), so no
 * target-specific host is baked in — parity holds across GCP / Local Docker / Remote Docker.
 */
export class FirestoreRegistryReader implements RegistryReader {
  constructor(
    private readonly connect: FirestoreConnectOptions = {},
    private readonly logger?: Logger,
  ) {}

  async listServers(): Promise<RegistryEntry[]> {
    const { db } = getBackupFirestore(this.connect, this.logger);
    const snap = await db.collection('mcp_servers').get();
    const entries: RegistryEntry[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as any;
      entries.push({
        name: d.name || doc.id,
        url: d.url,
        profile: d.profile,
        exposure: d.exposure || d.mcpExposure,
        transport: d.transport,
      });
    });
    this.logger?.info({ action: 'fleet.registry.read', count: entries.length }, `Read ${entries.length} Bit(s) from mcp_servers`);
    return entries;
  }
}
