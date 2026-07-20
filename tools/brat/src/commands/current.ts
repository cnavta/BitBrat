/**
 * Sprint 349: 'brat current' Command
 *
 * Shows the currently active execution context.
 *
 * Usage:
 *   brat current
 *
 * Displays:
 *   - Context name
 *   - Source (from ~/.bratrc, BITBRAT_CONTEXT env var, or default)
 */

import { getCurrentContext } from '../config/bratrc';

/**
 * Execute 'brat current' command
 */
export function executeCurrent(): void {
  // Check environment variable first (it overrides ~/.bratrc)
  const envContext = process.env.BITBRAT_CONTEXT;
  if (envContext) {
    console.log(`Current context: ${envContext} (from BITBRAT_CONTEXT environment variable)`);
    return;
  }

  // Check ~/.bratrc
  const bratrcContext = getCurrentContext();
  if (bratrcContext) {
    console.log(`Current context: ${bratrcContext} (from ~/.bratrc)`);
    return;
  }

  // Default fallback
  console.log('Current context: local (default)');
  console.log('\nNo context has been set. Use "brat use <context>" to switch contexts.');
}

/**
 * Command metadata for help text
 */
export const currentCommand = {
  name: 'current',
  description: 'Show the current execution context',
  usage: 'brat current',
  examples: [
    'brat current    # Show current context',
  ],
  help: `
Shows the currently active execution context.

Context priority (first match wins):
  1. BITBRAT_CONTEXT environment variable
  2. current_context in ~/.bratrc (set via 'brat use')
  3. Default: 'local'

Examples:
  brat current         # Show current context
  brat use staging     # Switch to staging
  brat current         # Now shows: staging (from ~/.bratrc)

See also:
  brat use <context>      # Switch to a different context
  brat context list       # List all available contexts
`.trim(),
};
