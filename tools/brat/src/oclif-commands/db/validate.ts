/**
 * brat db:validate
 *
 * Sprint 361: Database command migration (Pattern 2: Business Logic Module)
 *
 * Validates data consistency between Firestore and PostgreSQL.
 * Useful for verifying migration success and detecting data drift.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { getFirestore } from '../../../../../src/common/firebase';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import {
  validateCollection,
  validateAll,
  formatValidationResult,
  formatValidationSummary,
  DEFAULT_COLLECTIONS,
  type ValidationOptions,
} from '../../business/db-validation';

export default class DbValidate extends BratCommand {
  static override description = 'Validate data consistency between Firestore and PostgreSQL';

  static override examples = [
    '<%= config.bin %> <%= command.id %> events',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> events --sample-size 500',
    '<%= config.bin %> <%= command.id %> --all --json',
  ];

  static override args = {
    collection: Args.string({
      description: 'Collection name to validate (omit to use --all)',
      required: false,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    all: Flags.boolean({
      description: 'Validate all collections',
      default: false,
    }),
    'sample-size': Flags.integer({
      description: 'Number of documents to sample per collection',
      default: 1000,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(DbValidate);

    // Validate DATABASE_URL
    if (!process.env.DATABASE_URL) {
      this.error('DATABASE_URL environment variable is required\nSet it to your PostgreSQL connection string, e.g.:\n  export DATABASE_URL="postgresql://bitbrat:password@localhost:5432/bitbrat"');
    }

    // Validate arguments
    if (!args.collection && !flags.all) {
      this.error('Either specify a collection name or use --all flag\nUsage: brat db:validate <collection> OR brat db:validate --all');
    }

    if (args.collection && flags.all) {
      this.error('Cannot specify both a collection name and --all flag');
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
      this.logger.error({ action: 'validate.preflight.error', error: health.error }, 'PostgreSQL not healthy');
      this.error(`PostgreSQL connection failed: ${health.error}`);
    }

    this.logger.info({ action: 'validate.preflight.ok', latency: health.latency }, 'PostgreSQL connection healthy');

    const options: ValidationOptions = {
      sampleSize: flags['sample-size'],
    };

    try {
      if (args.collection) {
        // Validate single collection
        const collectionName = args.collection as string;
        const result = await validateCollection(
          collectionName,
          firestore,
          postgres,
          options,
          this.logger
        );

        if (flags.json) {
          this.log(JSON.stringify(result, null, 2));
        } else {
          this.log(formatValidationResult(result));
        }

        // Exit with error code if validation failed
        if (!result.countMatch || result.checksumMismatches > 0) {
          process.exit(1);
        }
      } else {
        // Validate all collections
        const summary = await validateAll(
          DEFAULT_COLLECTIONS,
          firestore,
          postgres,
          options,
          this.logger
        );

        if (flags.json) {
          this.log(JSON.stringify(summary, null, 2));
        } else {
          this.log(formatValidationSummary(summary));

          // Print detailed results for collections with issues
          for (const result of summary.collections) {
            if (!result.countMatch || result.checksumMismatches > 0) {
              this.log(formatValidationResult(result));
            }
          }
        }

        // Exit with error code if validation failed
        if (!summary.success) {
          process.exit(1);
        }
      }
    } finally {
      await postgres.close();
    }
  }
}
