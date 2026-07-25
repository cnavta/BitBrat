/**
 * oclif Command: current
 * Sprint 360: CTX-006
 *
 * Shows the currently active execution context with its source.
 *
 * Context priority (first match wins):
 *   1. BITBRAT_CONTEXT environment variable
 *   2. current_context in ~/.bratrc (set via 'brat use')
 *   3. Default: 'local'
 *
 * Examples:
 *   brat current
 */

import { BratCommand } from './base';
import { executeCurrent } from '../commands/current';

export default class Current extends BratCommand {
  static description = 'Show the current execution context';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    // Delegate to business logic
    executeCurrent();
  }
}
