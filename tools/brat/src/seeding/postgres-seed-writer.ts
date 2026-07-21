/**
 * Sprint 352: PostgreSQL Seed Writer
 *
 * Story S6.2: Write seed data to PostgreSQL database.
 * Supports idempotent seeding with ON CONFLICT DO UPDATE.
 *
 * Story S3.1-S3.3: Includes schema verification before seeding.
 */

import { Pool } from 'pg';
import { SeedDataSet, SeedingOptions } from './seed-data-types';
import { generateSeedData } from './seed-data-definitions';
import { verifyPostgresSchema, printSchemaVerification } from './verify-schema';

/**
 * Seed result
 */
export interface SeedResult {
  success: boolean;
  message: string;
  counts: {
    routingRules: number;
    reflexes: number;
    personalities: number;
    contextPacks: number;
    apiTokens: number;
  };
  errors?: string[];
}

/**
 * Seed PostgreSQL database with initial data
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - Seeding options
 * @returns Seed result
 */
export async function seedPostgres(
  connectionString: string,
  options: SeedingOptions = {}
): Promise<SeedResult> {
  const pool = new Pool({ connectionString });
  const errors: string[] = [];

  try {
    // Sprint 352 S3.1-S3.3: Verify schema before seeding
    if (!options.dryRun) {
      console.log('Verifying PostgreSQL schema...');
      const schemaResult = await verifyPostgresSchema(connectionString);

      if (!schemaResult.success) {
        printSchemaVerification(schemaResult);
        return {
          success: false,
          message: 'Schema verification failed',
          counts: {
            routingRules: 0,
            reflexes: 0,
            personalities: 0,
            contextPacks: 0,
            apiTokens: 0,
          },
          errors: [`Missing required tables: ${schemaResult.missingRequired.join(', ')}`],
        };
      }

      printSchemaVerification(schemaResult);
    }

    // Generate seed data
    const seedData = generateSeedData(options);

    if (options.dryRun) {
      console.log('[DRY RUN] Would seed:');
      console.log(`  - ${seedData.routingRules.length} routing rules`);
      console.log(`  - ${seedData.reflexes.length} reflexes`);
      console.log(`  - ${seedData.personalities.length} personalities`);
      console.log(`  - ${seedData.contextPacks.length} context packs`);
      console.log(`  - ${seedData.apiTokens.length} API tokens`);

      return {
        success: true,
        message: 'Dry run completed',
        counts: {
          routingRules: seedData.routingRules.length,
          reflexes: seedData.reflexes.length,
          personalities: seedData.personalities.length,
          contextPacks: seedData.contextPacks.length,
          apiTokens: seedData.apiTokens.length,
        },
      };
    }

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Wipe existing data if requested
      if (options.wipe) {
        await wipeExistingData(client);
      }

      // Seed routing rules
      await seedRoutingRules(client, seedData);

      // Seed reflexes
      await seedReflexes(client, seedData);

      // Seed personalities
      await seedPersonalities(client, seedData);

      // Seed context packs
      await seedContextPacks(client, seedData);

      // Seed API tokens
      await seedApiTokens(client, seedData);

      // Commit transaction
      await client.query('COMMIT');

      return {
        success: true,
        message: 'Seed data written successfully',
        counts: {
          routingRules: seedData.routingRules.length,
          reflexes: seedData.reflexes.length,
          personalities: seedData.personalities.length,
          contextPacks: seedData.contextPacks.length,
          apiTokens: seedData.apiTokens.length,
        },
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    // Handle AggregateError (multiple errors)
    if (error.errors && Array.isArray(error.errors)) {
      error.errors.forEach((err: any) => {
        errors.push(err.message || String(err));
        console.error('Seed error:', err);
      });
    } else {
      errors.push(error.message || String(error));
      console.error('Seed error:', error);
    }

    return {
      success: false,
      message: `Seeding failed: ${error.message}`,
      counts: {
        routingRules: 0,
        reflexes: 0,
        personalities: 0,
        contextPacks: 0,
        apiTokens: 0,
      },
      errors,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Wipe existing seed data (for --wipe option)
 */
async function wipeExistingData(client: any): Promise<void> {
  await client.query('DELETE FROM routing_rules');
  await client.query('DELETE FROM reflexes');
  await client.query('DELETE FROM personalities');
  await client.query('DELETE FROM context_packs');
  await client.query('DELETE FROM api_tokens');
}

/**
 * Seed routing rules
 */
async function seedRoutingRules(client: any, seedData: SeedDataSet): Promise<void> {
  for (const rule of seedData.routingRules) {
    // Store the routing rule data as-is (camelCase fields preserved for TypeScript consumption)
    const data = {
      enabled: rule.enabled,
      priority: rule.priority,
      description: rule.description,
      logic: rule.logic, // Already a JSON string from seed data
      routing: rule.routing,
      enrichments: rule.enrichments || null,
    };

    await client.query(
      `INSERT INTO routing_rules (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [rule.id, JSON.stringify(data)]
    );
  }
}

/**
 * Seed reflexes
 */
async function seedReflexes(client: any, seedData: SeedDataSet): Promise<void> {
  for (const reflex of seedData.reflexes) {
    // Store the reflex data as-is (camelCase fields preserved for TypeScript consumption)
    const data = {
      name: reflex.name,
      tags: reflex.tags,
      match: reflex.match,
      active: reflex.active,
      priority: reflex.priority,
      conditions: reflex.conditions,
      description: reflex.description,
      candidateTemplate: reflex.candidateTemplate,
    };

    await client.query(
      `INSERT INTO reflexes (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [reflex.id, JSON.stringify(data)]
    );
  }
}

/**
 * Seed personalities
 */
async function seedPersonalities(client: any, seedData: SeedDataSet): Promise<void> {
  for (const personality of seedData.personalities) {
    // Store the personality data as-is (camelCase fields preserved for TypeScript consumption)
    const data = {
      name: personality.name,
      text: personality.text,
      status: personality.status,
      version: personality.version,
      tags: personality.tags || [],
      platform: personality.platform,
      model: personality.model,
    };

    await client.query(
      `INSERT INTO personalities (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [personality.id, JSON.stringify(data)]
    );
  }
}

/**
 * Seed context packs
 */
async function seedContextPacks(client: any, seedData: SeedDataSet): Promise<void> {
  for (const pack of seedData.contextPacks) {
    const data = {
      version: pack.version,
      title: pack.title,
      priority: pack.priority,
      format: pack.format,
      source: pack.source,
      content: pack.content,
    };

    await client.query(
      `INSERT INTO context_packs (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [pack.id, JSON.stringify(data)]
    );
  }
}

/**
 * Seed API tokens
 */
async function seedApiTokens(client: any, seedData: SeedDataSet): Promise<void> {
  for (const token of seedData.apiTokens) {
    // Store the API token data as-is (camelCase fields preserved for TypeScript consumption)
    const data = {
      tokenHash: token.tokenHash,
      userId: token.userId,
      description: token.description,
    };

    await client.query(
      `INSERT INTO api_tokens (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [token.tokenHash, JSON.stringify(data)]
    );
  }
}
