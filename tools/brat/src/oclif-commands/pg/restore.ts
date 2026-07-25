/**
 * brat pg:restore
 *
 * Sprint 361: PostgreSQL command migration (Pattern 2: Business Logic Module)
 *
 * Restores PostgreSQL database from JSON or SQL backup.
 * Dry-run by default - requires explicit confirmation for writes.
 */

import * as fs from 'fs';
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import {
  restoreFromJson,
  restoreFromSql,
  detectFormat,
  decompressData,
  type RestoreOptions,
} from '../../business/pg-backup';

export default class PgRestore extends BratCommand {
  static override description = 'Restore PostgreSQL database from JSON or SQL backup (dry-run by default)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --in backup.json  # Dry-run',
    '<%= config.bin %> <%= command.id %> --in backup.json --dry-run=false',
    '<%= config.bin %> <%= command.id %> --in backup.pgdump',
    '<%= config.bin %> <%= command.id %> --in backup.json.gz  # Auto-decompresses',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    in: Flags.string({
      description: 'Input backup file path',
      required: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Dry-run mode (default: true for safety)',
      default: true,
      allowNo: true,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(PgRestore);

    // Validate DATABASE_URL
    if (!process.env.DATABASE_URL) {
      this.error('DATABASE_URL environment variable is required\nSet it to your PostgreSQL connection string, e.g.:\n  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    }

    // Validate input file
    if (!fs.existsSync(flags.in)) {
      this.error(`Backup file not found: ${flags.in}`);
    }

    // Detect format
    const format = detectFormat(flags.in);
    this.logger.info({ action: 'pg.restore.format', format, path: flags.in }, `Detected format: ${format}`);

    const options: RestoreOptions = {
      dryRun: flags['dry-run'],
      mode: 'merge',  // Default to merge mode
    };

    if (format === 'json') {
      await this.restoreFromJson(flags.in, options);
    } else if (format === 'sql') {
      await this.restoreFromSql(flags.in, options);
    } else {
      this.error(`Unsupported format: ${format}`);
    }
  }

  private async restoreFromJson(inPath: string, options: RestoreOptions): Promise<void> {
    this.logger.info({ action: 'pg.restore.json.start', inPath, dryRun: options.dryRun }, 'Starting JSON restore...');

    if (options.dryRun) {
      this.log('[DRY RUN] No data will be written to the database');
    }

    // Read file
    let data: Buffer = fs.readFileSync(inPath);

    // Decompress if needed
    if (inPath.endsWith('.gz')) {
      this.logger.info({ action: 'pg.restore.json.decompress' }, 'Decompressing backup...');
      const decompressed = await decompressData(data);
      data = decompressed as any as Buffer;
    }

    // Parse JSON
    const backup = JSON.parse(data.toString('utf8'));

    // Create PostgreSQL connection
    const postgres = new PostgresDocumentStore({
      connectionString: process.env.DATABASE_URL!,
      poolSize: 10,
    });
    postgres.setLogger(this.logger);

    try {
      // Restore
      const result = await restoreFromJson(postgres, backup.data, options, this.logger);

      this.logger.info(
        {
          action: 'pg.restore.json.complete',
          restored: result.restored,
          errors: result.errors,
          dryRun: options.dryRun,
        },
        `Restore complete: ${result.restored} documents`
      );

      if (options.dryRun) {
        this.log(`[DRY RUN] Would restore ${result.restored} documents`);
        this.log('Re-run with --dry-run=false to actually restore data');
      } else {
        this.log(`✅ Restored ${result.restored} documents`);
        if (result.errors > 0) {
          this.log(`⚠️  Errors: ${result.errors}`);
        }
      }
    } finally {
      await postgres.close();
    }
  }

  private async restoreFromSql(inPath: string, options: RestoreOptions): Promise<void> {
    this.logger.info({ action: 'pg.restore.sql.start', inPath, dryRun: options.dryRun }, 'Starting SQL restore...');

    if (options.dryRun) {
      this.log('[DRY RUN] Would restore from SQL backup');
      this.log('Re-run with --dry-run=false to actually restore data');
      return;
    }

    const result = await restoreFromSql(
      inPath,
      process.env.DATABASE_URL!,
      options,
      this.logger
    );

    this.log(`✅ SQL restore complete`);
  }
}
