/**
 * brat bit cleanup
 *
 * Sprint 23: Task 2.3 - Bit cleanup utility
 *
 * Removes generated Bit files (source, test, Dockerfile, docker-compose).
 * Delegates to cmdBitCleanup() from cli/bit/cleanup.ts
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdBitCleanup } from '../../cli/bit/cleanup';

export default class BitCleanup extends BratCommand {
  static override description = 'Remove generated Bit files (dry-run by default)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> test-service',
    '<%= config.bin %> <%= command.id %> test-service --force',
    '<%= config.bin %> <%= command.id %> test-service --force --remove-from-arch',
  ];

  static override args = {
    name: Args.string({
      description: 'Bit name to clean up',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    force: Flags.boolean({
      description: 'Actually remove files (default is dry-run)',
      default: false,
    }),
    'remove-from-arch': Flags.boolean({
      description: 'Also remove entry from architecture.yaml',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(BitCleanup);

    this.logger.info({
      action: 'bit.cleanup',
      name: args.name,
      force: flags.force,
      removeFromArch: flags['remove-from-arch'],
    }, 'Cleaning up Bit files');

    // Adapt oclif flags to legacy CLI format
    const cmd = ['bit', 'cleanup', args.name];
    const rest: string[] = [];
    const legacyFlags: Record<string, any> = {};

    if (flags.force) legacyFlags.force = flags.force;
    if (flags['remove-from-arch']) legacyFlags['remove-from-arch'] = flags['remove-from-arch'];

    // Delegate to legacy business logic
    await cmdBitCleanup(cmd, rest, legacyFlags, this.logger);
  }
}
