/**
 * Sprint 349: brat context show
 *
 * Displays full YAML configuration for an execution context.
 * Redacts sensitive values (passwords, tokens) unless --raw is specified.
 */

import { ContextResolver } from '../../context/context-resolver';
import * as yaml from 'js-yaml';

export interface ContextShowOptions {
  /** Show raw values without redaction */
  raw?: boolean;
}

/**
 * Execute 'brat context show <name>' command
 */
export async function executeContextShow(contextName: string, options: ContextShowOptions = {}): Promise<void> {
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  try {
    // Get raw context
    const context = await resolver.getRawContext(contextName);

    if (!context) {
      console.error(`Error: Context '${contextName}' not found`);
      console.error('\nAvailable contexts:');
      const available = await resolver.listContexts();
      available.forEach(name => console.error(`  - ${name}`));
      process.exit(1);
    }

    // Redact sensitive values unless --raw is specified
    const output = options.raw ? context : redactSensitiveValues(context);

    // Output as YAML
    console.log(`# Execution Context: ${contextName}`);
    if (!options.raw) {
      console.log('# (Sensitive values redacted. Use --raw to see actual values)');
    }
    console.log();
    console.log(yaml.dump(output, { indent: 2, lineWidth: 100 }));

  } catch (error: any) {
    console.error(`Error showing context: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Redact sensitive values from context configuration
 */
function redactSensitiveValues(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveValues(item));
  }

  const redacted: any = {};

  for (const [key, value] of Object.entries(obj)) {
    // Redact fields with sensitive names
    const lowerKey = key.toLowerCase();
    const isSensitive =
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('key') && (lowerKey.includes('api') || lowerKey.includes('auth'));

    if (isSensitive && typeof value === 'string' && value.length > 0) {
      // Redact with asterisks (show first 2 chars for identification)
      redacted[key] = value.length > 2 ? `${value.substring(0, 2)}${'*'.repeat(8)}` : '*'.repeat(value.length);
    } else if (typeof value === 'object' && value !== null) {
      // Recursively redact nested objects
      redacted[key] = redactSensitiveValues(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
