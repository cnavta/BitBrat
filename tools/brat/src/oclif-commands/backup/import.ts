/**
 * brat backup import
 *
 * Sprint 361: Backup command migration (Pattern 1: Simple Delegation)
 *
 * Imports Firestore config collections from a JSON backup file.
 * Dry-run by default - requires --confirm for actual writes.
 */

import * as fs from 'fs';
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveBackupConnection } from '../../backup/connection';
import { getBackupFirestore } from '../../providers/gcp/firestore';
import { importConfig, ImportMode } from '../../backup/import';
import { ConfigurationError } from '../../orchestration/errors';

export default class BackupImport extends BratCommand {
  static override description = 'Import Firestore config collections from JSON backup (dry-run by default)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --in backup.json  # Dry-run',
    '<%= config.bin %> <%= command.id %> --in backup.json --confirm  # Actually write',
    '<%= config.bin %> <%= command.id %> --in backup.json --project-id my-project --confirm',
    '<%= config.bin %> <%= command.id %> --in backup.json --mode overwrite --confirm',
    '<%= config.bin %> <%= command.id %> --in backup.json --collections users,oauth --confirm',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    in: Flags.string({
      description: 'Input backup file path',
      required: true,
    }),
    'project-id': Flags.string({
      description: 'GCP project ID (required for real writes to GCP)',
      required: false,
    }),
    env: Flags.string({
      description: 'Environment name for connection resolution',
      required: false,
    }),
    mode: Flags.string({
      description: 'Import mode: merge (default), overwrite, or skip',
      options: ['merge', 'overwrite', 'skip'],
      default: 'merge',
    }),
    collections: Flags.string({
      description: 'Comma-separated list of collections to import (default: all)',
      required: false,
    }),
    'include-secrets': Flags.boolean({
      description: 'Include sensitive collections (opt-in)',
      default: false,
    }),
    confirm: Flags.boolean({
      description: 'Confirm write (default is dry-run)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output result as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(BackupImport);

    // Validate input file
    if (!fs.existsSync(flags.in)) {
      throw new ConfigurationError(`Backup file not found: ${flags.in}`);
    }

    // Validate mode
    const mode = flags.mode as ImportMode;

    // Determine if this is a real write
    const confirm = flags.confirm;

    // Resolve connection
    const conn = await resolveBackupConnection(
      { projectId: flags['project-id'], env: flags.env },
      {},
      this.logger
    );

    // Safety rail: real write to GCP requires explicit project-id
    if (confirm && !conn.isEmulator && !flags['project-id']) {
      throw new ConfigurationError(
        'Refusing a real GCP import without an explicit --project-id (safety check). ' +
        'Re-run with --project-id <id> to confirm the destination, or use --target for an emulator stack.'
      );
    }

    this.logger.info(
      {
        action: 'backup.import.target',
        target: conn.description,
        dryRun: !confirm,
        mode,
      },
      `Import target: ${conn.description} [${confirm ? 'WRITE' : 'dry-run'}, mode=${mode}]`
    );

    // Read envelope
    const envelope = JSON.parse(fs.readFileSync(flags.in, 'utf8'));

    const { db } = getBackupFirestore(conn.connectOptions, this.logger);

    try {
      // Parse collections
      const collections = flags.collections
        ? flags.collections.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // Import
      const result = await importConfig(db, envelope, {
        mode,
        collections,
        includeSecrets: flags['include-secrets'],
        confirm,
      }, this.logger);

      if (flags.json) {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log(`${result.dryRun ? '[DRY-RUN] ' : ''}Import target: ${conn.description}`);
        this.log(`Mode: ${result.mode}; total write op(s) ${result.dryRun ? 'planned' : 'issued'}: ${result.totalOps}`);

        for (const [col, s] of Object.entries(result.perCollection)) {
          this.log(`  ${col}: create ${s.created}, update ${s.updated}, skip ${s.skipped}`);
        }

        for (const w of result.warnings) {
          this.log(`  ! ${w}`);
        }

        if (result.dryRun) {
          this.log('\nThis was a dry-run. Re-run with --confirm to apply the changes.');
        }
      }
    } finally {
      if (conn.cleanup) await conn.cleanup();
    }
  }
}
