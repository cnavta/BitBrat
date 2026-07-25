/**
 * oclif Command: context validate
 * Sprint 360: CTX-004
 *
 * Validates execution context configuration for completeness and correctness.
 * Checks for common bootstrap issues before deployment.
 *
 * Examples:
 *   brat context validate local
 *   brat context validate staging --format json
 *   brat context validate local --verbose
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { ContextResolver } from '../../context/context-resolver';
import { validateContext, formatValidationResult } from '../../business/context-validation';

export default class ContextValidate extends BratCommand {
  static description = 'Validate execution context configuration';

  static examples = [
    '<%= config.bin %> <%= command.id %> local',
    '<%= config.bin %> <%= command.id %> staging --format json',
    '<%= config.bin %> <%= command.id %> local --verbose',
  ];

  static args = {
    name: Args.string({
      description: 'Context name to validate',
      required: true,
    }),
  };

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      description: 'Output format',
      options: ['text', 'json'],
      default: 'text',
    }),
  };

  async run(): Promise<any> {
    const { args, flags } = await this.parse(ContextValidate);

    const resolver = new ContextResolver(this.repoRoot);

    try {
      // Check if context exists
      const context = await resolver.getRawContext(args.name);
      if (!context) {
        this.log(`Error: Context '${args.name}' does not exist`);
        this.log(`Use 'brat context list' to see available contexts`);
        this.error(`Context '${args.name}' not found`, { exit: 1 });
      }

      // Run validation checks
      const result = await validateContext({
        repoRoot: this.repoRoot,
        contextName: args.name,
        context,
        verbose: flags.verbose || false,
      });

      // Output results
      if (flags.format === 'json') {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log(formatValidationResult(args.name, result));
      }

      // Exit with error code if validation failed
      if (!result.valid) {
        this.error(`Context validation failed with ${result.errors.length} error(s)`, { exit: 1 });
      }

      return result;
    } catch (error: any) {
      this.logger.error({ action: 'context.validate.error', context: args.name, error: error.message }, 'Error validating context');
      this.error(`Error validating context: ${error.message}`, { exit: 1 });
    }
  }
}
