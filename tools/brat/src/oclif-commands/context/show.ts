/**
 * oclif Command: context show
 * Sprint 360: CTX-002
 *
 * Displays full YAML configuration for an execution context.
 * Redacts sensitive values (passwords, tokens, env vars) unless --raw is specified.
 *
 * Examples:
 *   brat context show local
 *   brat context show staging --raw
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { ContextResolver } from '../../context/context-resolver';
import { redactSensitiveValues } from '../../business/redaction';
import * as yaml from 'js-yaml';

export default class ContextShow extends BratCommand {
  static description = 'Display configuration for an execution context';

  static examples = [
    '<%= config.bin %> <%= command.id %> local',
    '<%= config.bin %> <%= command.id %> staging --raw',
  ];

  static args = {
    name: Args.string({
      description: 'Context name to display',
      required: true,
    }),
  };

  static flags = {
    ...BratCommand.baseFlags,
    raw: Flags.boolean({
      description: 'Show unredacted values (passwords, tokens, secrets)',
      default: false,
    }),
  };

  async run(): Promise<any> {
    const { args, flags } = await this.parse(ContextShow);

    const resolver = new ContextResolver(this.repoRoot);

    try {
      // Get raw context
      const context = await resolver.getRawContext(args.name);

      if (!context) {
        this.log(`Error: Context '${args.name}' not found`);
        this.log('\nAvailable contexts:');
        const available = await resolver.listContexts();
        available.forEach((name) => this.log(`  - ${name}`));
        this.error(`Context '${args.name}' not found`, { exit: 1 });
      }

      // Redact sensitive values unless --raw is specified
      const output = flags.raw ? context : redactSensitiveValues(context).value;

      // Output as YAML
      this.log(`# Execution Context: ${args.name}`);
      if (!flags.raw) {
        this.log('# (Sensitive values redacted. Use --raw to see actual values)');
      }
      this.log();
      this.log(yaml.dump(output, { indent: 2, lineWidth: 100 }));

      return output;
    } catch (error: any) {
      this.logger.error({ action: 'context.show.error', context: args.name, error: error.message }, 'Error showing context');
      this.error(`Error showing context: ${error.message}`, { exit: 1 });
    }
  }
}
