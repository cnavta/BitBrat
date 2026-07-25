/**
 * oclif Command: use
 * Sprint 360: CTX-005
 *
 * Switch to a different execution context by updating ~/.bratrc.
 * This is the PRIMARY workflow for context management.
 *
 * Examples:
 *   brat use local
 *   brat use staging
 *   brat use prod
 */

import { Args } from '@oclif/core';
import { BratCommand } from './base';
import { executeUse } from '../commands/use';

export default class Use extends BratCommand {
  static description = 'Switch to a different execution context';

  static examples = [
    '<%= config.bin %> <%= command.id %> local',
    '<%= config.bin %> <%= command.id %> staging',
    '<%= config.bin %> <%= command.id %> prod',
  ];

  static args = {
    context: Args.string({
      description: 'Context name to switch to',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Use);

    // Delegate to business logic
    await executeUse(args.context);
  }
}
