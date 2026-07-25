/**
 * brat migrate:collection
 *
 * Sprint 361: Database command migration (Pattern 2: Business Logic Module)
 *
 * Migrates a single collection from Firestore to PostgreSQL.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { getFirestore } from '../../../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import {
  migrateCollection,
  DEFAULT_COLLECTIONS,
  type MigrationOptions,
} from '../../business/migration';

export default class MigrateCollection extends BratCommand {
  static override description = 'Migrate a single collection from Firestore to PostgreSQL';

  static override examples = [
    '<%= config.bin %> <%= command.id %> events',
    '<%= config.bin %> <%= command.id %> events --dry-run',
    '<%= config.bin %> <%= command.id %> users',
  ];

  static override args = {
    collection: Args.string({
      description: 'Collection name to migrate',
      required: true,
      options: DEFAULT_COLLECTIONS,
    }),
  };

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
    const { args, flags } = await this.parse(MigrateCollection);

    // Validate DATABASE_URL
    if (!process.env.DATABASE_URL) {
      this.error('DATABASE_URL environment variable is required\nSet it to your PostgreSQL connection string, e.g.:\n  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    }

    // Validate collection
    if (!DEFAULT_COLLECTIONS.includes(args.collection)) {
      this.error(`Unknown collection: ${args.collection}\nValid collections: ${DEFAULT_COLLECTIONS.join(', ')}`);
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

    this.logger.info({ action: 'migrate.preflight.ok', latency: health.latency }, 'PostgreSQL connection healthy');

    if (flags['dry-run']) {
      this.log(`[DRY RUN] Would migrate collection: ${args.collection}`);
    }

    const options: MigrationOptions = {
      dryRun: flags['dry-run'],
      onProgress: flags.json ? undefined : (current, total) => {
        if (current % 100 === 0 || current === total) {
          this.log(`  Progress: ${current}/${total} documents migrated`);
        }
      },
    };

    try {
      const result = await migrateCollection(
        args.collection,
        firestore,
        postgres,
        options,
        this.logger
      );

      if (flags.json) {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log();
        this.log('Migration complete:');
        this.log(`  Migrated: ${result.migrated}`);
        this.log(`  Errors: ${result.errors}`);
        this.log(`  Duration: ${result.duration}ms`);

        if (result.errors > 0) {
          process.exit(1);
        }
      }
    } finally {
      await postgres.close();
    }
  }
}
