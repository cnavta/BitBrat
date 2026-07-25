/**
 * brat pg:backup
 *
 * Sprint 361: PostgreSQL command migration (Pattern 2: Business Logic Module)
 *
 * Backs up PostgreSQL database to JSON or SQL format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import {
  backupToJson,
  backupToSql,
  compressData,
  DEFAULT_COLLECTIONS,
  type BackupOptions,
} from '../../business/pg-backup';

export default class PgBackup extends BratCommand {
  static override description = 'Backup PostgreSQL database to JSON or SQL format';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --out backup.json',
    '<%= config.bin %> <%= command.id %> --out backup.json --compress',
    '<%= config.bin %> <%= command.id %> --out backup.pgdump --format sql',
    '<%= config.bin %> <%= command.id %> --out backup.json --collections events,users',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    out: Flags.string({
      description: 'Output file path',
      required: true,
    }),
    format: Flags.string({
      description: 'Backup format',
      options: ['json', 'sql'],
      default: 'json',
    }),
    collections: Flags.string({
      description: 'Comma-separated list of collections (default: all)',
      required: false,
    }),
    compress: Flags.boolean({
      description: 'Compress backup (gzip for JSON, pg_dump compression for SQL)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(PgBackup);

    // Validate DATABASE_URL
    if (!process.env.DATABASE_URL) {
      this.error('DATABASE_URL environment variable is required\nSet it to your PostgreSQL connection string, e.g.:\n  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    }

    // Parse collections
    const collections = flags.collections
      ? flags.collections.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_COLLECTIONS;

    const options: BackupOptions = {
      collections,
      compress: flags.compress,
    };

    if (flags.format === 'json') {
      await this.backupToJson(flags.out, options);
    } else if (flags.format === 'sql') {
      await this.backupToSql(flags.out, options);
    } else {
      this.error(`Invalid format: ${flags.format}`);
    }
  }

  private async backupToJson(outPath: string, options: BackupOptions): Promise<void> {
    this.logger.info({ action: 'pg.backup.json.start', outPath }, 'Starting JSON backup...');

    // Create PostgreSQL connection
    const postgres = new PostgresDocumentStore({
      connectionString: process.env.DATABASE_URL!,
      poolSize: 10,
    });
    postgres.setLogger(this.logger);

    try {
      // Backup
      const result = await backupToJson(postgres, options, this.logger);

      // Serialize
      const json = JSON.stringify(result, null, 2);
      let data: Buffer = Buffer.from(json, 'utf8');

      // Compress if requested
      if (options.compress) {
        this.logger.info({ action: 'pg.backup.json.compress' }, 'Compressing backup...');
        data = await compressData(data) as Buffer;
      }

      // Write
      const finalPath = options.compress && !outPath.endsWith('.gz') ? `${outPath}.gz` : outPath;
      fs.writeFileSync(finalPath, data);

      this.logger.info(
        {
          action: 'pg.backup.json.complete',
          path: finalPath,
          size: data.length,
          collections: result.metadata.collections,
          documents: result.metadata.totalDocuments,
        },
        `Backup complete: ${finalPath}`
      );

      this.log(`✅ Backed up ${result.metadata.totalDocuments} documents from ${result.metadata.collections} collections → ${finalPath}`);
      if (options.compress) {
        this.log(`   Compressed size: ${(data.length / 1024).toFixed(2)} KB`);
      }
    } finally {
      await postgres.close();
    }
  }

  private async backupToSql(outPath: string, options: BackupOptions): Promise<void> {
    this.logger.info({ action: 'pg.backup.sql.start', outPath }, 'Starting SQL backup...');

    const result = await backupToSql(
      outPath,
      process.env.DATABASE_URL!,
      options,
      this.logger
    );

    this.log(`✅ SQL backup complete: ${result.path}`);
    this.log(`   Size: ${(result.size / 1024).toFixed(2)} KB`);
  }
}
