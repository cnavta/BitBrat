/**
 * Sprint 352: PostgreSQL Seed Writer
 *
 * Story S6.2: Write seed data to PostgreSQL database.
 * Supports idempotent seeding with ON CONFLICT DO UPDATE.
 */

import { Pool } from 'pg';
import { SeedDataSet, SeedingOptions } from './seed-data-types';
import { generateSeedData } from './seed-data-definitions';

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
    errors.push(error.message || String(error));
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
    await client.query(
      `INSERT INTO routing_rules (
        id, enabled, priority, description, logic, routing_slip, stage, enrichments, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        priority = EXCLUDED.priority,
        description = EXCLUDED.description,
        logic = EXCLUDED.logic,
        routing_slip = EXCLUDED.routing_slip,
        stage = EXCLUDED.stage,
        enrichments = EXCLUDED.enrichments,
        updated_at = NOW()`,
      [
        rule.id,
        rule.enabled,
        rule.priority,
        rule.description,
        JSON.stringify(rule.logic),
        JSON.stringify(rule.routingSlip),
        rule.stage,
        rule.enrichments ? JSON.stringify(rule.enrichments) : null,
      ]
    );
  }
}

/**
 * Seed reflexes
 */
async function seedReflexes(client: any, seedData: SeedDataSet): Promise<void> {
  for (const reflex of seedData.reflexes) {
    await client.query(
      `INSERT INTO reflexes (
        id, trigger_pattern, match_type, case_sensitive, response_template, response_type,
        enabled, priority, description, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        trigger_pattern = EXCLUDED.trigger_pattern,
        match_type = EXCLUDED.match_type,
        case_sensitive = EXCLUDED.case_sensitive,
        response_template = EXCLUDED.response_template,
        response_type = EXCLUDED.response_type,
        enabled = EXCLUDED.enabled,
        priority = EXCLUDED.priority,
        description = EXCLUDED.description,
        updated_at = NOW()`,
      [
        reflex.id,
        reflex.triggerPattern,
        reflex.matchType,
        reflex.caseSensitive,
        reflex.responseTemplate,
        reflex.responseType,
        reflex.enabled,
        reflex.priority,
        reflex.description,
      ]
    );
  }
}

/**
 * Seed personalities
 */
async function seedPersonalities(client: any, seedData: SeedDataSet): Promise<void> {
  for (const personality of seedData.personalities) {
    await client.query(
      `INSERT INTO personalities (
        id, name, instructions, description, status, version, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        instructions = EXCLUDED.instructions,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        updated_at = NOW()`,
      [
        personality.id,
        personality.name,
        personality.instructions,
        personality.description,
        personality.status,
        personality.version,
      ]
    );
  }
}

/**
 * Seed context packs
 */
async function seedContextPacks(client: any, seedData: SeedDataSet): Promise<void> {
  for (const pack of seedData.contextPacks) {
    await client.query(
      `INSERT INTO context_packs (
        id, version, title, priority, format, source, content, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        version = EXCLUDED.version,
        title = EXCLUDED.title,
        priority = EXCLUDED.priority,
        format = EXCLUDED.format,
        source = EXCLUDED.source,
        content = EXCLUDED.content,
        updated_at = NOW()`,
      [
        pack.id,
        pack.version,
        pack.title,
        pack.priority,
        pack.format,
        pack.source,
        pack.content,
      ]
    );
  }
}

/**
 * Seed API tokens
 */
async function seedApiTokens(client: any, seedData: SeedDataSet): Promise<void> {
  for (const token of seedData.apiTokens) {
    await client.query(
      `INSERT INTO api_tokens (
        token_hash, uid, description, created_at
      ) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (token_hash) DO UPDATE SET
        uid = EXCLUDED.uid,
        description = EXCLUDED.description`,
      [
        token.tokenHash,
        token.uid,
        token.description,
      ]
    );
  }
}
