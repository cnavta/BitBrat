import { Args, Flags } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetFlags extends FleetCommand {
  static description = 'Get or set feature flags';
  
  static args = {
    bit: Args.string({
      description: 'Bit name',
      required: true,
    }),
  };
  
  static flags = {
    ...FleetCommand.baseFlags,
    key: Flags.string({
      description: 'Flag key',
      required: true,
    }),
    value: Flags.string({
      description: 'Flag value (for set operation)',
    }),
  };
  
  protected get subcommand(): string {
    return 'flags';
  }
}
