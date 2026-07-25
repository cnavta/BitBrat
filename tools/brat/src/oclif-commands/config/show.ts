/**
 * Config Show Command
 *
 * Displays resolved configuration for the current execution context.
 * Redacts sensitive values (passwords, tokens, secrets) by default.
 * Use --raw to show unredacted values.
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /key/i,
  /apikey/i,
  /api_key/i,
  /auth/i,
  /credential/i,
];

export default class ConfigShow extends BratCommand {
  static description = 'Display resolved configuration for current execution context';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --raw',
    '<%= config.bin %> <%= command.id %> --context staging',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['yaml', 'json'],
      default: 'yaml',
    }),
    raw: Flags.boolean({
      char: 'r',
      description: 'Show unredacted values (passwords, tokens, secrets)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow);

    this.logger.debug({ context: this.context.name, format: flags.format, raw: flags.raw }, 'Showing configuration');

    try {
      // Load architecture.yaml
      const archPath = path.join(this.repoRoot, 'architecture.yaml');

      if (!fs.existsSync(archPath)) {
        this.error(`architecture.yaml not found at ${archPath}. Run 'brat setup' to initialize.`, { exit: 1 });
      }

      const archContent = fs.readFileSync(archPath, 'utf8');
      const config = yaml.load(archContent) as any;

      // Redact sensitive values unless --raw is specified
      const displayConfig = flags.raw ? config : this.redactSensitiveValues(config);

      // Output in requested format
      if (flags.format === 'json') {
        this.log(JSON.stringify(displayConfig, null, 2));
      } else {
        this.log(yaml.dump(displayConfig, { lineWidth: -1, noRefs: true }));
      }

      this.logger.debug({ fieldCount: Object.keys(displayConfig).length }, 'Configuration displayed');
    } catch (error: any) {
      this.logger.error({ error: error.message, stack: error.stack }, 'Config show failed');
      this.error(error.message || 'Failed to display configuration', { exit: 1 });
    }
  }

  /**
   * Recursively redact sensitive values in configuration object
   */
  private redactSensitiveValues(obj: any, visited = new WeakSet()): any {
    // Handle primitives
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Prevent circular references
    if (visited.has(obj)) {
      return '[Circular Reference]';
    }
    visited.add(obj);

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveValues(item, visited));
    }

    // Handle objects
    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if this is a sensitive field
      const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

      if (isSensitive && typeof value === 'string') {
        // Redact sensitive string values
        if (value.length === 0) {
          redacted[key] = '';
        } else if (value.startsWith('${') && value.endsWith('}')) {
          // Environment variable interpolation - redact the var name but show it's interpolated
          redacted[key] = '${********}';
        } else if (value.length <= 4) {
          redacted[key] = '*'.repeat(value.length);
        } else {
          // Show first 2 chars, redact the rest
          redacted[key] = value.substring(0, 2) + '*'.repeat(value.length - 2);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redactSensitiveValues(value, visited);
      } else {
        // Non-sensitive value, keep as is
        redacted[key] = value;
      }
    }

    return redacted;
  }
}
