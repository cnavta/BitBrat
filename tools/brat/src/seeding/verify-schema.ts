/**
 * Sprint 352 S3.1-S3.3: PostgreSQL Schema Verification
 *
 * Verifies that the PostgreSQL database has all required tables for seeding.
 * Provides actionable error messages when schema is missing or incorrect.
 */

import { Pool } from 'pg';

/**
 * Required tables for seed data
 */
export const REQUIRED_TABLES = [
  'routing_rules',
  'reflexes',
  'personalities',
  'context_packs',
  'api_tokens',
] as const;

/**
 * Optional tables that should exist in a full installation
 */
export const OPTIONAL_TABLES = [
  'events',
  'snapshots',
  'sources',
  'state',
  'mutation_log',
  'twitch_tokens',
  'tool_usage',
  'prompt_logs',
  'disposition_observations',
  'auth_users',
  'auth_scopes',
  'user_state',
  'global_state',
  'sessions',
  'conversation_history',
  'llm_responses',
  'integration_configs',
  'metrics',
  'service_registry',
] as const;

/**
 * Schema verification result
 */
export interface SchemaVerificationResult {
  /** Whether all required tables exist */
  success: boolean;
  /** Missing required tables */
  missingRequired: string[];
  /** Missing optional tables */
  missingOptional: string[];
  /** Tables that exist */
  existing: string[];
  /** Actionable error message if verification failed */
  errorMessage?: string;
  /** Suggested fix commands */
  suggestedFixes?: string[];
}

/**
 * Verify PostgreSQL schema has all required tables
 *
 * @param connectionString - PostgreSQL connection string
 * @returns Verification result
 */
export async function verifyPostgresSchema(
  connectionString: string
): Promise<SchemaVerificationResult> {
  const pool = new Pool({ connectionString });

  try {
    // Query to check which tables exist
    const result = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN (${[...REQUIRED_TABLES, ...OPTIONAL_TABLES]
        .map((t) => `'${t}'`)
        .join(', ')})
    `);

    const existingTables = new Set(result.rows.map((r) => r.tablename));

    // Check required tables
    const missingRequired = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

    // Check optional tables
    const missingOptional = OPTIONAL_TABLES.filter((t) => !existingTables.has(t));

    const success = missingRequired.length === 0;

    // Build error message and suggested fixes
    let errorMessage: string | undefined;
    let suggestedFixes: string[] | undefined;

    if (!success) {
      errorMessage = buildErrorMessage(missingRequired, missingOptional, existingTables);
      suggestedFixes = buildSuggestedFixes(missingRequired, existingTables);
    }

    return {
      success,
      missingRequired,
      missingOptional,
      existing: Array.from(existingTables),
      errorMessage,
      suggestedFixes,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Build actionable error message for missing tables
 */
function buildErrorMessage(
  missingRequired: string[],
  missingOptional: string[],
  existingTables: Set<string>
): string {
  const lines: string[] = [];

  lines.push('❌ PostgreSQL schema verification failed');
  lines.push('');
  lines.push(`Missing ${missingRequired.length} required table(s) for seeding:`);

  for (const table of missingRequired) {
    lines.push(`  - ${table}`);
  }

  if (existingTables.size === 0) {
    lines.push('');
    lines.push('⚠️  No BitBrat tables found in database!');
    lines.push('   This looks like a fresh PostgreSQL database that has not been initialized.');
  } else if (existingTables.size < 5) {
    lines.push('');
    lines.push(`⚠️  Only ${existingTables.size} BitBrat table(s) found:`);
    for (const table of existingTables) {
      lines.push(`  - ${table}`);
    }
    lines.push('');
    lines.push('   This database may be partially initialized.');
  }

  if (missingOptional.length > 0) {
    lines.push('');
    lines.push(`Also missing ${missingOptional.length} optional table(s):`);
    lines.push(`  ${missingOptional.slice(0, 5).join(', ')}${missingOptional.length > 5 ? '...' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Build suggested fix commands
 */
function buildSuggestedFixes(missingRequired: string[], existingTables: Set<string>): string[] {
  const fixes: string[] = [];

  if (existingTables.size === 0) {
    // Completely fresh database
    fixes.push('Initialize the database with Docker Compose:');
    fixes.push('  docker compose -f infrastructure/docker-compose/docker-compose.local.yaml up -d postgres');
    fixes.push('');
    fixes.push('The init scripts in infrastructure/postgres/init/ will run automatically.');
    fixes.push('');
    fixes.push('Or run the init script manually:');
    fixes.push('  psql $DATABASE_URL < infrastructure/postgres/init/02-create-tables.sql');
  } else if (missingRequired.includes('routing_rules') && existingTables.has('commands')) {
    // Migration from commands to routing_rules not run
    fixes.push('Run migration 001 to rename commands → routing_rules:');
    fixes.push('  psql $DATABASE_URL < infrastructure/postgres/migrations/001-rename-commands-to-routing-rules.sql');
  } else if (missingRequired.length > 0) {
    // Some tables missing, run specific migrations
    fixes.push('Run the following migrations in order:');
    if (missingRequired.includes('reflexes')) {
      fixes.push('  psql $DATABASE_URL < infrastructure/postgres/migrations/006-add-reflexes-table.sql');
    }
    if (missingRequired.includes('personalities')) {
      fixes.push('  psql $DATABASE_URL < infrastructure/postgres/migrations/013-add-personalities-table.sql');
    }
    if (missingRequired.includes('api_tokens')) {
      fixes.push('  psql $DATABASE_URL < infrastructure/postgres/migrations/004-add-api-tokens-table.sql');
    }
    if (missingRequired.includes('context_packs') || missingRequired.includes('routing_rules')) {
      fixes.push('  psql $DATABASE_URL < infrastructure/postgres/init/02-create-tables.sql');
    }
  }

  fixes.push('');
  fixes.push('Then retry: brat seed');

  return fixes;
}

/**
 * Print schema verification result to console
 *
 * @param result - Verification result
 */
export function printSchemaVerification(result: SchemaVerificationResult): void {
  if (result.success) {
    console.log('✅ PostgreSQL schema verified successfully');
    console.log(`   Found ${result.existing.length} tables`);
    console.log();
    return;
  }

  // Print error message
  console.error();
  console.error(result.errorMessage);
  console.error();

  // Print suggested fixes
  if (result.suggestedFixes && result.suggestedFixes.length > 0) {
    console.error('Suggested fixes:');
    console.error();
    for (const fix of result.suggestedFixes) {
      console.error(fix);
    }
    console.error();
  }
}

/**
 * Verify schema and throw if invalid
 *
 * @param connectionString - PostgreSQL connection string
 * @throws Error if schema verification fails
 */
export async function verifySchemaOrThrow(connectionString: string): Promise<void> {
  const result = await verifyPostgresSchema(connectionString);

  if (!result.success) {
    printSchemaVerification(result);
    throw new Error('PostgreSQL schema verification failed');
  }
}
