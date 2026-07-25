/**
 * brat migrate:all
 *
 * Sprint 361: Database command migration (Pattern 2: Business Logic Module)
 *
 * Migrates all collections from Firestore to PostgreSQL.
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { getFirestore } from '../../../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import {
  migrateAll,
  DEFAULT_COLLECTIONS,
  type MigrationOptions,
} from '../../business/migration';

export default class MigrateAll extends BratCommand {
  static override description = 'Migrate all collections from Firestore to PostgreSQL';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'dry-run': Flags.boolean({
      description: 'Dry-run mode (preview without writing)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(MigrateAll);

    // Validate DATABASE_URL
    if (!process.env.DATABASE_URL) {
      this.error('DATABASE_URL environment variable is required\nSet it to your PostgreSQL connection string, e.g.:\n  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    }

    // Get database connections
    const firestore = getFirestore();
    const postgres = new PostgresDocumentStore({
      connectionString: process.env.DATABASE_URL!,
      poolSize: 10,
    });
    postgres.setLogger(this.logger);

    // Check PostgreSQL connection
    const health = await postgres.health();
    if (!health.healthy) {
      this.logger.error({ action: 'migrate.preflight.error', error: health.error }, 'PostgreSQL not healthy');
      this.error(`PostgreSQL connection failed: ${health.error}`);
    }

    this.logger.info({ action: 'migrate.all.start', collections: DEFAULT_COLLECTIONS.length }, 'Starting full migration');

    if (flags['dry-run']) {
      this.log(`[DRY RUN] Would migrate all ${DEFAULT_COLLECTIONS.length} collections`);
    }

    const options: MigrationOptions = {
      dryRun: flags['dry-run'],
    };

    try {
      // Show progress for each collection
      let currentIndex = 0;
      for (const collection of DEFAULT_COLLECTIONS) {
        currentIndex++;
        if (!flags.json) {
          this.log();
          this.log(`[${currentIndex}/${DEFAULT_COLLECTIONS.length}] Migrating ${collection}...`);
        }
      }

      const result = await migrateAll(
        DEFAULT_COLLECTIONS,
        firestore,
        postgres,
        options,
        this.logger
      );

      if (flags.json) {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log();
        this.log('='.repeat(60));
        this.log('Migration Summary:');
        this.log('='.repeat(60));

        for (const [collection, stats] of Object.entries(result.collections)) {
          this.log(`  ${collection.padEnd(25)} ${stats.migrated} docs (${stats.errors} errors)`);
        }

        this.log('='.repeat(60));
        this.log(`Total: ${result.totalMigrated} documents migrated`);
        if (result.totalErrors > 0) {
          this.log(`Errors: ${result.totalErrors}`);
          process.exit(1);
        }
      }
    } finally {
      await postgres.close();
    }
  }
}
