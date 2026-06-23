import { Firestore } from 'firebase-admin/firestore';
import type { Logger } from '../orchestration/logger';
import { ConfigurationError } from '../orchestration/errors';
import { decodeDocumentData } from './serializer';
import {
  BackupCollectionSpec,
  CONFIG_BACKUP_REGISTRY,
  FORBIDDEN_PREFIXES,
  REGISTRY_VERSION,
  assertRegistrySafe,
  findSpec,
  isForbiddenPath,
} from './registry';
import { BACKUP_FORMAT, BackupDocumentNode, BackupEnvelope, SCHEMA_VERSION } from './types';

export type ImportMode = 'merge' | 'overwrite' | 'skip';

export interface ImportOptions {
  mode?: ImportMode;
  /** Restrict import to this subset of collection paths present in the envelope. */
  collections?: string[];
  /** Import collections marked `sensitive` in the registry. Default false. */
  includeSecrets?: boolean;
  /** A real write requires confirm:true; otherwise this is a dry-run (default). */
  confirm?: boolean;
}

export interface CollectionImportStats {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportResult {
  dryRun: boolean;
  mode: ImportMode;
  perCollection: Record<string, CollectionImportStats>;
  totalOps: number;
  warnings: string[];
}

/** Validate the envelope shape/version before any write (TA §6.2). */
export function validateEnvelope(envelope: any): asserts envelope is BackupEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    throw new ConfigurationError('Backup file is not a valid JSON object.');
  }
  if (envelope.format !== BACKUP_FORMAT) {
    throw new ConfigurationError(`Unexpected backup format '${envelope.format}'; expected '${BACKUP_FORMAT}'.`);
  }
  if (envelope.schemaVersion !== SCHEMA_VERSION) {
    throw new ConfigurationError(
      `Incompatible backup schemaVersion ${envelope.schemaVersion}; this brat supports ${SCHEMA_VERSION}.`,
    );
  }
  if (!envelope.collections || typeof envelope.collections !== 'object') {
    throw new ConfigurationError('Backup envelope is missing a "collections" map.');
  }
}

/**
 * Re-apply the FORBIDDEN_PREFIXES guard to the *input* so a hand-edited backup file can never
 * inject events/log data on import (TA §6.2).
 */
function assertEnvelopeSafe(envelope: BackupEnvelope): void {
  for (const path of Object.keys(envelope.collections)) {
    if (isForbiddenPath(path)) {
      throw new ConfigurationError(
        `Backup file contains a forbidden (log/event) collection path '${path}'. Refusing to import.`,
      );
    }
  }
}

interface WriteSink {
  set(path: string, data: Record<string, unknown>, merge: boolean): void;
}

/**
 * Recursively process a document node and its subcollections, classifying create/update/skip and
 * (unless dry-run) queueing writes. Parents are written before their subcollections.
 */
async function importNode(
  db: Firestore,
  collectionPath: string,
  node: BackupDocumentNode,
  mode: ImportMode,
  stats: CollectionImportStats,
  sink: WriteSink | null,
  logger?: Logger,
): Promise<void> {
  const docPath = `${collectionPath}/${node.id}`;
  const ref = db.doc(docPath);
  const existing = await ref.get();
  const exists = existing.exists;

  if (mode === 'skip' && exists) {
    stats.skipped += 1;
  } else {
    const data = decodeDocumentData(node.data, db);
    const merge = mode === 'merge';
    if (sink) sink.set(docPath, data as Record<string, unknown>, merge);
    if (exists) stats.updated += 1; else stats.created += 1;
  }

  // Recurse into subcollections (always — even when the parent was skipped, nested config may
  // still need seeding). Re-apply the forbidden guard defensively.
  for (const [subId, childNodes] of Object.entries(node.subcollections || {})) {
    if (FORBIDDEN_PREFIXES.includes(subId)) {
      throw new ConfigurationError(`Refusing to import forbidden subcollection '${subId}' under ${docPath}.`);
    }
    const subPath = `${docPath}/${subId}`;
    for (const child of childNodes) {
      await importNode(db, subPath, child, mode, stats, sink, logger);
    }
  }
}

/**
 * Import a backup envelope into Firestore. Dry-run by default; a real write requires
 * `options.confirm === true`.
 */
export async function importConfig(
  db: Firestore,
  envelope: any,
  options: ImportOptions = {},
  logger?: Logger,
  registry: BackupCollectionSpec[] = CONFIG_BACKUP_REGISTRY,
): Promise<ImportResult> {
  validateEnvelope(envelope);
  assertRegistrySafe(registry);
  assertEnvelopeSafe(envelope);

  const mode: ImportMode = options.mode || 'merge';
  const dryRun = options.confirm !== true;
  const warnings: string[] = [];

  if (typeof envelope.metadata?.registryVersion === 'number' &&
      envelope.metadata.registryVersion !== REGISTRY_VERSION) {
    warnings.push(
      `Backup registryVersion ${envelope.metadata.registryVersion} != current ${REGISTRY_VERSION}; proceeding (values are re-validated).`,
    );
  }

  let paths = Object.keys(envelope.collections);
  if (options.collections && options.collections.length > 0) {
    paths = paths.filter((p) => options.collections!.includes(p));
  }

  // Set up the write sink (BulkWriter) only for a real write.
  let bulkWriter: ReturnType<Firestore['bulkWriter']> | null = null;
  let totalOps = 0;
  let sink: WriteSink | null = null;
  if (!dryRun) {
    bulkWriter = db.bulkWriter();
    sink = {
      set: (path, data, merge) => {
        totalOps += 1;
        bulkWriter!.set(db.doc(path), data, merge ? { merge: true } : {});
      },
    };
  } else {
    // In dry-run we still count the ops that *would* be issued.
    sink = { set: () => { totalOps += 1; } };
  }

  const perCollection: Record<string, CollectionImportStats> = {};

  for (const path of paths) {
    if (isForbiddenPath(path)) {
      throw new ConfigurationError(`Refusing to import forbidden collection path '${path}'.`);
    }
    const spec = findSpec(path, registry);
    if (spec?.sensitive && !options.includeSecrets) {
      warnings.push(`Skipped sensitive collection '${path}' (use --include-secrets to import it).`);
      logger?.info({ action: 'backup.import.skipSensitive', path }, `Skipping sensitive '${path}'`);
      continue;
    }
    const stats: CollectionImportStats = { created: 0, updated: 0, skipped: 0 };
    const nodes: BackupDocumentNode[] = envelope.collections[path] || [];
    logger?.info({ action: 'backup.import.collection', path, count: nodes.length, dryRun },
      `${dryRun ? '[dry-run] ' : ''}Importing '${path}' (${nodes.length} docs, mode=${mode})`);
    for (const node of nodes) {
      await importNode(db, path, node, mode, stats, sink, logger);
    }
    perCollection[path] = stats;
  }

  if (bulkWriter) {
    await bulkWriter.close();
  }

  return { dryRun, mode, perCollection, totalOps, warnings };
}
