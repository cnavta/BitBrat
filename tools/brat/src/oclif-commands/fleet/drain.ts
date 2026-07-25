import { Args } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetDrain extends FleetCommand {
  static description = 'Gracefully drain Bit(s)';
  
  static args = {
    bit: Args.string({
      description: 'Bit name to drain',
      required: false,
    }),
  };
  
  static flags = {
    ...FleetCommand.baseFlags,
  };
  
  protected get subcommand(): string {
    return 'drain';
  }
}
