/**
 * oclif Command: fleet info
 * Sprint 360: FLT-002
 *
 * Get bit.info from single Bit or all Bits in fleet.
 *
 * Examples:
 *   brat fleet info
 *   brat fleet info llm-bot
 *   brat fleet info --all --json
 */

import { Args } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetInfo extends FleetCommand {
  static description = 'Get bit.info from Bit(s)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> llm-bot',
    '<%= config.bin %> <%= command.id %> --all --json',
  ];

  static args = {
    bit: Args.string({
      description: 'Bit name to query',
      required: false,
    }),
  };

  static flags = {
    ...FleetCommand.baseFlags,
  };

  protected get subcommand(): string {
    return 'info';
  }
}
