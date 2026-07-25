/**
 * oclif Command: config validate
 * Sprint 360: CFG-001
 *
 * Validates architecture.yaml against Zod schema and JSON schema.
 * Two-tier validation:
 *   1. Runtime Zod schema (ArchitectureSchema) - source of truth for tooling
 *   2. Published JSON Schema - for humans and agents to self-validate
 *
 * Examples:
 *   brat config validate
 *   brat config validate --format json
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { validateConfig, formatConfigValidationResult } from '../../business/config-validator';

export default class ConfigValidate extends BratCommand {
  static description = 'Validate architecture.yaml configuration';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      description: 'Output format',
      options: ['text', 'json'],
      default: 'text',
    }),
  };

  async run(): Promise<any> {
    const { flags } = await this.parse(ConfigValidate);

    // Run validation
    const result = validateConfig({
      repoRoot: this.repoRoot,
    });

    // Output results
    if (flags.format === 'json') {
      this.log(JSON.stringify(result, null, 2));
    } else {
      this.log(formatConfigValidationResult(result));
    }

    // Exit with error code if validation failed
    if (!result.valid) {
      this.error(`Config validation failed with ${result.issues.length} issue(s)`, { exit: 1 });
    }

    return result;
  }
}
