/**
 * brat seed
 *
 * Sprint 361: Database command migration (Pattern 1: Simple Delegation)
 *
 * Seeds database with initial data (routing rules, context packs, service registry, etc.).
 * Auto-detects persistence driver from execution context.
 */

import { Flags } from '@oclif/core';
import { Firestore } from '@google-cloud/firestore';
import { BratCommand } from './base';
import { seedPostgres } from '../seeding/postgres-seed-writer';
import { seedFirestore } from '../seeding/firestore-seed-writer';
import type { SeedingOptions } from '../seeding/seed-data-types';

export default class Seed extends BratCommand {
  static override description = 'Seed database with initial data (routing rules, context packs, etc.)';

  static override examples = [
    '<%= config.bin %> <%= command.id %>  # Seed with defaults',
    '<%= config.bin %> <%= command.id %> --bot-name MyBot',
    '<%= config.bin %> <%= command.id %> --wipe  # Wipe existing data first',
    '<%= config.bin %> <%= command.id %> --dry-run  # Preview without writing',
    '<%= config.bin %> <%= command.id %> --context staging',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'bot-name': Flags.string({
      description: 'Bot name for initial config',
      default: 'BitBrat',
    }),
    'api-token': Flags.string({
      description: 'API token for API gateway',
      required: false,
    }),
    wipe: Flags.boolean({
      description: 'Wipe existing data before seeding (DESTRUCTIVE)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Dry-run mode (preview without writing)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Seed);

    // Use already-resolved context from BratCommand.init()
    const persistenceDriver = this.context.runtime.persistence.driver;

    this.log();
    this.log('='.repeat(60));
    this.log('BitBrat Seed Data Command');
    this.log('='.repeat(60));
    this.log();
    this.log(`Context: ${this.context.name}`);
    this.log(`Persistence Driver: ${persistenceDriver}`);
    this.log(`Bot Name: ${flags['bot-name']}`);
    this.log(`Dry Run: ${flags['dry-run'] ? 'YES' : 'NO'}`);
    this.log(`Wipe Existing: ${flags.wipe ? 'YES' : 'NO'}`);
    this.log();

    const seedingOptions: SeedingOptions = {
      contextName: this.context.name,
      botName: flags['bot-name'],
      dryRun: flags['dry-run'],
      wipe: flags.wipe,
      apiToken: flags['api-token'],
    };

    let result;

    if (persistenceDriver === 'postgres') {
      // PostgreSQL seeding
      const conn = this.context.runtime.persistence.connection;
      if (!conn) {
        this.error('PostgreSQL connection configuration not found in context');
      }
      const connectionString = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;

      this.log('Seeding PostgreSQL database...');
      this.log();

      result = await seedPostgres(connectionString, seedingOptions);
    } else if (persistenceDriver === 'firestore') {
      // Firestore seeding
      this.log('Seeding Firestore database...');
      this.log();

      const firestore = new Firestore({
        projectId: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID,
      });

      result = await seedFirestore(firestore, seedingOptions);
    } else {
      this.error(`Unknown persistence driver '${persistenceDriver}'\nSet PERSISTENCE_DRIVER to "postgres" or "firestore"`);
    }

    // Display results
    this.log();
    this.log('='.repeat(60));
    this.log('Seed Results');
    this.log('='.repeat(60));
    this.log();
    this.log(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    this.log(`Message: ${result.message}`);
    this.log();
    this.log('Seeded:');
    this.log(`  - Routing Rules: ${result.counts.routingRules}`);
    this.log(`  - Reflexes: ${result.counts.reflexes}`);
    this.log(`  - Personalities: ${result.counts.personalities}`);
    this.log(`  - Context Packs: ${result.counts.contextPacks}`);
    this.log(`  - API Tokens: ${result.counts.apiTokens}`);
    this.log();

    if (!result.success) {
      this.error(result.message);
    }
  }
}
