import { ConfigurationError } from '../orchestration/errors';

/**
 * Declarative registry of Firestore collections that are part of the platform's
 * **core configuration** and are therefore eligible for `brat backup` export/import.
 *
 * The backup set is an explicit ALLOWLIST (see Technical Architecture §3.3): any collection
 * not listed here is never exported. This is fail-safe — future log/event collections are
 * excluded by default rather than silently captured.
 */
export interface BackupCollectionSpec {
  /** Top-level collection id or a path to a nested collection, e.g. "configs/routingRules/rules". */
  path: string;
  /** Recurse into ALL subcollections of each document (default true). */
  recurseSubcollections?: boolean;
  /** Explicit subcollection allowlist; when set, only these subcollections are followed. */
  subcollections?: string[];
  /** Treat docs as sensitive (skip unless --include-secrets). */
  sensitive?: boolean;
  /** Field paths stripped on EXPORT (volatile/runtime fields on otherwise-config docs). */
  stripFields?: string[];
  /** Human rationale (kept in code + surfaced by `brat backup list`). */
  rationale: string;
}

/**
 * Registry schema version. Bumped when the registry shape/membership changes in a way that
 * a consumer (importer) should be aware of. Recorded in the backup envelope metadata.
 */
export const REGISTRY_VERSION = 1;

export const CONFIG_BACKUP_REGISTRY: BackupCollectionSpec[] = [
  { path: 'users', recurseSubcollections: true, rationale: 'User profiles + roles subcollection' },
  { path: 'stories', rationale: 'Authored story definitions' },
  { path: 'configs', recurseSubcollections: true, rationale: 'Routing rules, bot roles, etc.' },
  { path: 'stream_observers', rationale: 'Stream observer config' },
  { path: 'mcp_servers', rationale: 'Registered MCP servers' },
  { path: 'schedules', rationale: 'Scheduled job definitions' },
  {
    path: 'sources',
    stripFields: ['status', 'streamStatus', 'metrics', 'lastHeartbeat',
      'lastStatusUpdate', 'lastStreamUpdate', 'lastError', 'viewerCount', 'latencyMs'],
    rationale: 'Configured sources/channels (volatile status fields stripped)',
  },
  { path: 'gateways/api/tokens', sensitive: true, rationale: 'API tokens (opt-in via --include-secrets)' },
];

/**
 * Hard guard: collection ids/prefixes that must NEVER appear in a backup, even if someone
 * mistakenly adds them to the registry. This is the belt-and-braces enforcement of the sprint
 * brief's "the events collection and other log-based collections MUST NOT be included" rule.
 */
export const FORBIDDEN_PREFIXES = ['events', 'mutation_log', 'state', 'summarization_runs',
  'tool_usage', 'prompt_logs'];

/**
 * Split a collection path into its path segments. A collection path alternates
 * collection / document / collection / document ... so the collection ids are the
 * even-indexed segments (0, 2, 4, ...).
 */
export function collectionSegments(collectionPath: string): string[] {
  return collectionPath.split('/').filter((s) => s.length > 0);
}

/**
 * Returns true if the given collection path touches any forbidden (log/event) collection at
 * any level of nesting. We check every collection-id segment against FORBIDDEN_PREFIXES.
 */
export function isForbiddenPath(collectionPath: string): boolean {
  const segments = collectionSegments(collectionPath);
  for (let i = 0; i < segments.length; i += 2) {
    const collectionId = segments[i];
    if (FORBIDDEN_PREFIXES.includes(collectionId)) return true;
  }
  return false;
}

/**
 * Startup assertion: fails fast (ConfigurationError) if any registry path matches a forbidden
 * prefix. Must be invoked on BOTH export and import so a hand-edited registry or backup file can
 * never round-trip log/event data.
 */
export function assertRegistrySafe(registry: BackupCollectionSpec[] = CONFIG_BACKUP_REGISTRY): void {
  for (const spec of registry) {
    if (isForbiddenPath(spec.path)) {
      throw new ConfigurationError(
        `Backup registry contains a forbidden (log/event) collection path: '${spec.path}'. ` +
        `Collections matching FORBIDDEN_PREFIXES (${FORBIDDEN_PREFIXES.join(', ')}) must never be backed up.`,
      );
    }
  }
}

/** Look up a registry spec by its collection path. */
export function findSpec(path: string, registry: BackupCollectionSpec[] = CONFIG_BACKUP_REGISTRY): BackupCollectionSpec | undefined {
  return registry.find((s) => s.path === path);
}
