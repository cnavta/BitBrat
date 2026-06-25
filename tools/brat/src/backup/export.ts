import {
  CollectionReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';
import type { Logger } from '../orchestration/logger';
import { ConfigurationError } from '../orchestration/errors';
import { encodeDocumentData } from './serializer';
import {
  BackupCollectionSpec,
  CONFIG_BACKUP_REGISTRY,
  FORBIDDEN_PREFIXES,
  REGISTRY_VERSION,
  assertRegistrySafe,
  isForbiddenPath,
} from './registry';
import {
  BACKUP_FORMAT,
  BRAT_BACKUP_VERSION,
  BackupDocumentNode,
  BackupEnvelope,
  SCHEMA_VERSION,
} from './types';
import { FirestoreTarget } from '../providers/gcp/firestore';

export interface ExportOptions {
  /** Restrict export to this subset of registry paths (each must exist in the registry). */
  collections?: string[];
  /** Include collections marked `sensitive` (e.g. API tokens). Default false. */
  includeSecrets?: boolean;
}

export interface ExportResult {
  envelope: BackupEnvelope;
  documentCount: number;
}

/** Recurse default is true unless a spec explicitly opts out. */
function shouldRecurse(spec: BackupCollectionSpec): boolean {
  return spec.recurseSubcollections !== false;
}

/** Strip volatile/runtime fields from a top-level document's data before encoding (TA §5.2). */
function applyStripFields(data: Record<string, unknown>, stripFields?: string[]): Record<string, unknown> {
  if (!stripFields || stripFields.length === 0) return data;
  const out = { ...data };
  for (const f of stripFields) delete out[f];
  return out;
}

/**
 * Export one document and (optionally) its subcollections into a BackupDocumentNode.
 * Forbidden subcollections (log/event) are skipped defensively, never exported.
 *
 * Returns `null` when there is nothing to export for this path — i.e. the document does not exist
 * in its own right (a Firestore "phantom"/missing parent) AND it has no exportable subcollections.
 * A phantom parent that *does* hold subcollections is preserved (with `missing: true` and empty
 * data) so its nested config is captured.
 */
async function exportDocument(
  snap: DocumentSnapshot,
  spec: BackupCollectionSpec,
  opts: { recurse: boolean; stripFields?: string[] },
  counter: { n: number },
  logger?: Logger,
): Promise<BackupDocumentNode | null> {
  const subcollections: Record<string, BackupDocumentNode[]> = {};

  if (opts.recurse) {
    const subcols = await snap.ref.listCollections();
    for (const sub of subcols) {
      // Honor an explicit subcollection allowlist when present.
      if (spec.subcollections && !spec.subcollections.includes(sub.id)) continue;
      // Fail-safe: never descend into a forbidden (log/event) subcollection.
      if (FORBIDDEN_PREFIXES.includes(sub.id) || isForbiddenPath(sub.path)) {
        logger?.debug({ action: 'backup.export.skipForbidden', path: sub.path }, `Skipping forbidden subcollection ${sub.path}`);
        continue;
      }
      const childNodes = await exportCollectionDocs(sub, spec, { recurse: true }, counter, logger);
      if (childNodes.length > 0) subcollections[sub.id] = childNodes;
    }
  }

  const exists = snap.exists;
  const hasSubcollections = Object.keys(subcollections).length > 0;

  // A phantom parent with no (exportable) subcollections carries no information — drop it.
  if (!exists && !hasSubcollections) return null;

  const node: BackupDocumentNode = {
    id: snap.id,
    data: exists
      ? encodeDocumentData(applyStripFields((snap.data() || {}) as Record<string, unknown>, opts.stripFields))
      : {},
    subcollections,
  };

  if (exists) {
    // Only real documents count toward the exported document total; phantom parents are structural.
    counter.n += 1;
  } else {
    node.missing = true;
    logger?.debug({ action: 'backup.export.phantomParent', path: snap.ref.path },
      `Captured phantom parent ${snap.ref.path} solely to preserve its subcollections`);
  }
  return node;
}

/**
 * Export all documents of a collection reference into nodes (used for both top-level + nested).
 *
 * Uses `listDocuments()` rather than `get()` so that Firestore "phantom"/missing parent documents
 * (which hold subcollections but have no fields of their own, and are therefore NOT returned by a
 * collection query) are still enumerated and their nested config captured. Without this, paths such
 * as `configs/routingRules/rules` are silently omitted whenever `configs/routingRules` itself has
 * no top-level fields.
 */
async function exportCollectionDocs(
  col: CollectionReference,
  spec: BackupCollectionSpec,
  opts: { recurse: boolean; stripFields?: string[] },
  counter: { n: number },
  logger?: Logger,
): Promise<BackupDocumentNode[]> {
  const refs = await col.listDocuments();
  const nodes: BackupDocumentNode[] = [];
  for (const ref of refs) {
    const snap = await ref.get();
    const node = await exportDocument(snap, spec, opts, counter, logger);
    if (node) nodes.push(node);
  }
  return nodes;
}

/**
 * Export the configured collections into a versioned backup envelope. Strictly read-only.
 */
export async function exportConfig(
  db: Firestore,
  target: FirestoreTarget,
  options: ExportOptions = {},
  logger?: Logger,
  registry: BackupCollectionSpec[] = CONFIG_BACKUP_REGISTRY,
): Promise<ExportResult> {
  // Belt-and-braces: the registry must never contain a forbidden path.
  assertRegistrySafe(registry);

  let specs = registry;
  if (options.collections && options.collections.length > 0) {
    const unknown = options.collections.filter((c) => !registry.some((s) => s.path === c));
    if (unknown.length > 0) {
      throw new ConfigurationError(`Unknown collection(s) not in the backup registry: ${unknown.join(', ')}`);
    }
    specs = registry.filter((s) => options.collections!.includes(s.path));
  }

  const collections: Record<string, BackupDocumentNode[]> = {};
  const counter = { n: 0 };

  for (const spec of specs) {
    if (spec.sensitive && !options.includeSecrets) {
      logger?.info({ action: 'backup.export.skipSensitive', path: spec.path },
        `Skipping sensitive collection '${spec.path}' (use --include-secrets to include)`);
      continue;
    }
    // Defensive double-check per path.
    if (isForbiddenPath(spec.path)) {
      throw new ConfigurationError(`Refusing to export forbidden collection path '${spec.path}'`);
    }
    logger?.info({ action: 'backup.export.collection', path: spec.path }, `Exporting '${spec.path}'`);
    const col = db.collection(spec.path);
    const nodes = await exportCollectionDocs(col, spec, { recurse: shouldRecurse(spec), stripFields: spec.stripFields }, counter, logger);
    collections[spec.path] = nodes;
  }

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      exportedAt: new Date().toISOString(),
      sourceProjectId: target.projectId,
      databaseId: target.databaseId,
      emulatorHost: target.emulatorHost,
      bratVersion: BRAT_BACKUP_VERSION,
      registryVersion: REGISTRY_VERSION,
      includeSecrets: !!options.includeSecrets,
      collectionCount: Object.keys(collections).length,
      documentCount: counter.n,
    },
    collections,
  };

  return { envelope, documentCount: counter.n };
}
