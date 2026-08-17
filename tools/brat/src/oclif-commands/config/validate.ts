/**
 * oclif Command: config validate
 * Sprint 360: CFG-001
 * Sprint 6: S6-F1.2 - Add --schema v2 support
 *
 * Validates architecture.yaml against Zod schema and JSON schema.
 * Three-tier validation:
 *   1. Runtime Zod schema (ArchitectureSchema) - source of truth for tooling (default)
 *   2. JSON Schema v1 - legacy validation
 *   3. JSON Schema v2 - comprehensive v2 infrastructure model validation (--schema v2)
 *
 * Examples:
 *   brat config validate
 *   brat config validate --schema v2
 *   brat config validate --schema v2 --format json
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { validateConfig, formatConfigValidationResult } from '../../business/config-validator';
import {
  ArchitectureSchemaV2Validator,
  type ValidationResult,
} from '../../validation/architecture-schema-v2';

export default class ConfigValidate extends BratCommand {
  static description = 'Validate architecture.yaml configuration';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --schema v2',
    '<%= config.bin %> <%= command.id %> --schema v2 --format json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      description: 'Output format',
      options: ['text', 'json'],
      default: 'text',
    }),
    schema: Flags.string({
      description: 'Schema version to validate against (v1, v2, or zod for runtime)',
      options: ['v1', 'v2', 'zod'],
      default: 'zod',
    }),
  };

  async run(): Promise<any> {
    const { flags } = await this.parse(ConfigValidate);

    // Route to appropriate validator based on schema flag
    if (flags.schema === 'v2') {
      return this.runV2Validation(flags);
    }

    // Default: Use Zod validation
    return this.runZodValidation(flags);
  }

  /**
   * Run JSON Schema v2 validation
   */
  private async runV2Validation(flags: any): Promise<ValidationResult> {
    this.logger.info('Running architecture.yaml v2 schema validation...');

    const validator = new ArchitectureSchemaV2Validator(this.repoRoot);
    const result = validator.validate();

    // Output results
    if (flags.format === 'json') {
      this.log(JSON.stringify(result, null, 2));
    } else {
      this.log(ArchitectureSchemaV2Validator.formatResults(result));
    }

    // Exit with error code if validation failed
    if (!result.valid) {
      this.error(`Schema v2 validation failed with ${result.errors.length} error(s)`, {
        exit: 1,
      });
    }

    return result;
  }

  /**
   * Run Zod schema validation (default)
   */
  private async runZodValidation(flags: any): Promise<any> {
    this.logger.info('Running architecture.yaml Zod schema validation...');

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
