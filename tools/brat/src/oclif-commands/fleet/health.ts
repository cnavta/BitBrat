/**
 * oclif Command: fleet health
 * Sprint 360: FLT-003
 *
 * Get bit.health from single Bit or all Bits in fleet.
 *
 * Examples:
 *   brat fleet health llm-bot
 *   brat fleet health --all
 */

import { Args } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetHealth extends FleetCommand {
  static description = 'Get bit.health from Bit(s)';

  static examples = [
    '<%= config.bin %> <%= command.id %> llm-bot',
    '<%= config.bin %> <%= command.id %> --all',
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
    return 'health';
  }
}
