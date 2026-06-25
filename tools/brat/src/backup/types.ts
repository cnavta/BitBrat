import { EncodedValue } from './serializer';

/** Stable envelope identifiers (Technical Architecture §5.1). */
export const BACKUP_FORMAT = 'bitbrat.config-backup';
export const SCHEMA_VERSION = 1;
/** brat backup tool version, recorded in metadata for traceability. */
export const BRAT_BACKUP_VERSION = '0.1.0';

/**
 * A single backed-up document: its id, its (typed-encoded) field data, and any nested
 * subcollections keyed by subcollection id. Document IDs are preserved and re-applied on import.
 */
export interface BackupDocumentNode {
  id: string;
  data: Record<string, EncodedValue>;
  subcollections: Record<string, BackupDocumentNode[]>;
  /**
   * True when this document does not exist in its own right and is only present as a *parent path*
   * for nested subcollections (a Firestore "phantom"/missing document — e.g. `configs/routingRules`
   * created solely by writing `configs/routingRules/rules/<id>`). Such parents carry no field data
   * and MUST NOT be (re)created as empty documents on import; they exist only so their
   * subcollections can be captured and restored. Omitted (undefined) for real documents.
   */
  missing?: boolean;
}

export interface BackupMetadata {
  exportedAt: string;
  sourceProjectId: string;
  databaseId: string;
  emulatorHost?: string;
  bratVersion: string;
  registryVersion: number;
  includeSecrets: boolean;
  collectionCount: number;
  documentCount: number;
}

/** The full versioned backup envelope written to / read from disk. */
export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  metadata: BackupMetadata;
  /** Top-level config collection path -> its documents (each with nested subcollections). */
  collections: Record<string, BackupDocumentNode[]>;
}
