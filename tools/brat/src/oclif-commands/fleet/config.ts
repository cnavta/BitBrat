import { Args, Flags } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetConfig extends FleetCommand {
  static description = 'Get bit.config from Bit';
  
  static args = {
    bit: Args.string({
      description: 'Bit name to query',
      required: true,
    }),
  };
  
  static flags = {
    ...FleetCommand.baseFlags,
    describe: Flags.boolean({
      description: 'Get config schema (bit.config.describe)',
      default: false,
    }),
  };
  
  protected get subcommand(): string {
    return 'config';
  }
}
