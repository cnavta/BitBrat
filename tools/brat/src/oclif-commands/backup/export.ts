/**
 * brat backup export
 *
 * Sprint 361: Backup command migration (Pattern 1: Simple Delegation)
 *
 * Exports Firestore config collections to a JSON backup file.
 * Read-only operation - does not modify any data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveBackupConnection } from '../../backup/connection';
import { getBackupFirestore } from '../../providers/gcp/firestore';
import { exportConfig } from '../../backup/export';

export default class BackupExport extends BratCommand {
  static override description = 'Export Firestore config collections to JSON backup';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --project-id my-project',
    '<%= config.bin %> <%= command.id %> --out backup.json --pretty',
    '<%= config.bin %> <%= command.id %> --collections users,oauth --include-secrets',
    '<%= config.bin %> <%= command.id %> --json  # Stream to stdout',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID (overrides environment default)',
      required: false,
    }),
    env: Flags.string({
      description: 'Environment name for connection resolution',
      required: false,
    }),
    out: Flags.string({
      description: 'Output file path (default: auto-generated timestamp file)',
      required: false,
    }),
    collections: Flags.string({
      description: 'Comma-separated list of collections to export (default: all)',
      required: false,
    }),
    'include-secrets': Flags.boolean({
      description: 'Include sensitive collections (opt-in)',
      default: false,
    }),
    pretty: Flags.boolean({
      description: 'Pretty-print JSON output',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output JSON to stdout (instead of file)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(BackupExport);

    // Resolve connection
    const conn = await resolveBackupConnection(
      { projectId: flags['project-id'], env: flags.env },
      {},
      this.logger
    );

    this.logger.info(
      { action: 'backup.export.target', target: conn.description },
      `Export target: ${conn.description}`
    );

    const { db, target } = getBackupFirestore(conn.connectOptions, this.logger);

    try {
      // Parse collections
      const collections = flags.collections
        ? flags.collections.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // Export
      const result = await exportConfig(db, target, {
        collections,
        includeSecrets: flags['include-secrets'],
      }, this.logger);

      // Format JSON
      const json = (flags.pretty || flags.json)
        ? JSON.stringify(result.envelope, null, 2)
        : JSON.stringify(result.envelope);

      if (flags.json && !flags.out) {
        // Stream to stdout
        this.log(json);
      } else {
        // Write to file
        const outPath = flags.out || this.defaultOutPath(target.projectId);
        fs.writeFileSync(outPath, json, 'utf8');

        this.logger.info(
          {
            action: 'backup.export.written',
            outPath,
            documents: result.documentCount,
            collections: result.envelope.metadata.collectionCount,
          },
          `Wrote backup to ${outPath}`
        );

        this.log(`Exported ${result.documentCount} document(s) across ${result.envelope.metadata.collectionCount} collection(s) → ${outPath}`);

        if (!result.envelope.metadata.includeSecrets) {
          this.log('Note: sensitive collections were excluded (re-run with --include-secrets to include them).');
        }
      }
    } finally {
      if (conn.cleanup) await conn.cleanup();
    }
  }

  private defaultOutPath(projectId: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(process.cwd(), `bitbrat-config-backup-${projectId}-${stamp}.json`);
  }
}
