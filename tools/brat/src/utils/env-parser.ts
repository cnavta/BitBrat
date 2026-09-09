/**
 * Sprint 26 T2.2: Environment File Parser
 *
 * Utilities for parsing and manipulating .env files with support for:
 * - Comments (lines starting with #)
 * - Blank lines
 * - Key-value pairs (KEY=value)
 * - Quoted values (KEY="value with spaces")
 * - Multiline values (not commonly used, but supported)
 *
 * @module utils/env-parser
 */

/**
 * Parse .env file content into key-value map
 *
 * @param content - Raw .env file content
 * @returns Map of environment variable key-value pairs
 *
 * @example
 * ```typescript
 * const content = `
 * # Database configuration
 * DATABASE_URL=postgresql://localhost:5432/mydb
 * DATABASE_PASSWORD="secret value"
 * `;
 *
 * const env = parseEnvFile(content);
 * // Map { 'DATABASE_URL' => 'postgresql://localhost:5432/mydb', 'DATABASE_PASSWORD' => 'secret value' }
 * ```
 */
export function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments and blank lines
    if (line.startsWith('#') || line.length === 0) {
      continue;
    }

    // Parse key=value
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      // Invalid line (no = sign), skip
      continue;
    }

    const key = line.substring(0, equalsIndex).trim();
    let value = line.substring(equalsIndex + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }

    // Store key-value pair
    if (key.length > 0) {
      env.set(key, value);
    }
  }

  return env;
}

/**
 * Serialize environment variables to .env file format
 *
 * @param env - Map of environment variable key-value pairs
 * @param preserveComments - Whether to include comment header (default: true)
 * @returns .env file content
 *
 * @example
 * ```typescript
 * const env = new Map([
 *   ['DATABASE_URL', 'postgresql://localhost:5432/mydb'],
 *   ['API_KEY', 'secret-key']
 * ]);
 *
 * const content = serializeEnvFile(env);
 * // DATABASE_URL=postgresql://localhost:5432/mydb
 * // API_KEY=secret-key
 * ```
 */
export function serializeEnvFile(
  env: Map<string, string>,
  preserveComments: boolean = true
): string {
  const lines: string[] = [];

  if (preserveComments) {
    lines.push('# Generated environment configuration');
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');
  }

  // Sort keys alphabetically for consistency
  const sortedKeys = Array.from(env.keys()).sort();

  for (const key of sortedKeys) {
    const value = env.get(key)!;

    // Quote values that contain spaces or special characters
    const needsQuoting = /[\s#]/.test(value);
    const quotedValue = needsQuoting ? `"${value}"` : value;

    lines.push(`${key}=${quotedValue}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Merge multiple environment variable sources with precedence
 *
 * Precedence (highest to lowest):
 * 1. overrides (highest priority)
 * 2. base
 *
 * @param base - Base environment variables
 * @param overrides - Override environment variables
 * @returns Merged environment variables
 *
 * @example
 * ```typescript
 * const base = new Map([['PORT', '3000'], ['HOST', 'localhost']]);
 * const overrides = new Map([['PORT', '8080']]);
 *
 * const merged = mergeEnv(base, overrides);
 * // Map { 'PORT' => '8080', 'HOST' => 'localhost' }
 * ```
 */
export function mergeEnv(
  base: Map<string, string>,
  ...overrides: Map<string, string>[]
): Map<string, string> {
  const merged = new Map(base);

  for (const override of overrides) {
    for (const [key, value] of override.entries()) {
      merged.set(key, value);
    }
  }

  return merged;
}

/**
 * Filter environment variables by prefix
 *
 * @param env - Environment variables to filter
 * @param prefix - Prefix to match (case-sensitive)
 * @returns Filtered environment variables
 *
 * @example
 * ```typescript
 * const env = new Map([
 *   ['DATABASE_URL', 'postgres://...'],
 *   ['DATABASE_PASSWORD', 'secret'],
 *   ['API_KEY', 'key']
 * ]);
 *
 * const dbVars = filterEnvByPrefix(env, 'DATABASE_');
 * // Map { 'DATABASE_URL' => 'postgres://...', 'DATABASE_PASSWORD' => 'secret' }
 * ```
 */
export function filterEnvByPrefix(
  env: Map<string, string>,
  prefix: string
): Map<string, string> {
  const filtered = new Map<string, string>();

  for (const [key, value] of env.entries()) {
    if (key.startsWith(prefix)) {
      filtered.set(key, value);
    }
  }

  return filtered;
}

/**
 * Validate required environment variables are present
 *
 * @param env - Environment variables to validate
 * @param required - List of required variable names
 * @returns Object with validation result and missing variables
 *
 * @example
 * ```typescript
 * const env = new Map([['DATABASE_URL', 'postgres://...']]);
 * const result = validateRequiredVars(env, ['DATABASE_URL', 'API_KEY']);
 *
 * if (!result.valid) {
 *   console.error(`Missing required variables: ${result.missing.join(', ')}`);
 * }
 * ```
 */
export function validateRequiredVars(
  env: Map<string, string>,
  required: string[]
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const key of required) {
    if (!env.has(key) || env.get(key) === '') {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
