/**
 * oclif Command: fleet list
 * Sprint 360: FLT-001
 *
 * Lists all live Bits in the fleet with their profile and exposure metadata.
 *
 * Delegates to FleetCommand base class which orchestrates:
 * - Registry resolution (postgres vs firestore)
 * - Gateway URL resolution
 * - Transport creation (gateway or direct)
 * - FleetClient lifecycle
 * - Dispatch to fleet-dispatcher business logic
 *
 * Examples:
 *   brat fleet list
 *   brat fleet list --json
 *   brat fleet list --context staging
 */

import { FleetCommand } from '../fleet-command';

export default class FleetList extends FleetCommand {
  static description = 'List all live Bits in the fleet';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --context staging',
  ];

  static flags = {
    ...FleetCommand.baseFlags,
  };

  protected get subcommand(): string {
    return 'list';
  }
}
