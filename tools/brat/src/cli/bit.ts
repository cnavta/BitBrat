/**
 * Command group entry point for brat bit commands
 * Sprint 331: BL-331-106
 */

import { createLogger } from '../orchestration/logger';
import { cmdBitCreate } from './bit/create';

const log = createLogger({ base: { component: 'brat-bit' } });

/**
 * Main entry point for brat bit command group
 */
export async function cmdBit(
  cmd: string[],
  rest: string[],
  flags: Record<string, any>
): Promise<void> {
  const subcommand = cmd[1]; // cmd[0] is 'bit'

  // Show help if no subcommand or help flag
  if (!subcommand || flags.help || flags.h) {
    printBitHelp();
    return;
  }

  // Route to subcommands
  if (subcommand === 'create') {
    await cmdBitCreate(cmd, rest, flags, log);
    return;
  }

  // Unknown subcommand
  console.error(`Error: Unknown subcommand '${subcommand}'`);
  console.error('');
  printBitHelp();
  process.exit(2);
}

/**
 * Print help text for brat bit command group
 */
function printBitHelp(): void {
  console.log(`
brat bit - Bit lifecycle management commands

Usage:
  brat bit <subcommand> [options]

Subcommands:
  create <name>     Create a new Bit with modern configuration

  Future subcommands (not yet implemented):
    list            List all Bits from architecture.yaml
    describe <name> Show Bit details from architecture.yaml
    validate <name> Validate Bit configuration

Options:
  --help, -h        Show this help message

Examples:
  brat bit create my-service
  brat bit create api-gateway --profile gateway --exposure platform+domain
  brat bit create --help

For more information on a specific subcommand:
  brat bit <subcommand> --help
`);
}
