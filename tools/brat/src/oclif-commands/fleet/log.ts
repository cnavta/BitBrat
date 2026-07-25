import { Args, Flags } from '@oclif/core';
import { FleetCommand } from '../fleet-command';

export default class FleetLog extends FleetCommand {
  static description = 'Set runtime log level';
  
  static args = {
    bit: Args.string({
      description: 'Bit name',
      required: true,
    }),
  };
  
  static flags = {
    ...FleetCommand.baseFlags,
    level: Flags.string({
      description: 'Log level',
      options: ['error', 'warn', 'info', 'debug', 'trace'],
      required: true,
    }),
  };
  
  protected get subcommand(): string {
    return 'log';
  }
}
