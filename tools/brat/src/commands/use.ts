/**
 * Sprint 349: 'brat use' Command
 *
 * Primary workflow for context switching. Sets current context in ~/.bratrc.
 *
 * Usage:
 *   brat use local
 *   brat use staging
 *   brat use prod
 *
 * This is the MOST IMPORTANT command in Sprint 349.
 */

import { ContextResolver } from '../context/context-resolver';
import { setCurrentContext, getCurrentContext } from '../config/bratrc';

/**
 * Execute 'brat use <context>' command
 */
export async function executeUse(contextName: string): Promise<void> {
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  // Validate context exists
  const exists = await resolver.contextExists(contextName);
  if (!exists) {
    const available = await resolver.listContexts();
    throw new Error(
      `Unknown context: '${contextName}'.\n\n` +
      `Available contexts: ${available.join(', ')}\n\n` +
      `Contexts are defined in architecture.yaml under 'executionContexts'.`
    );
  }

  // Get current context (before switching)
  const previousContext = getCurrentContext();

  // Set new context in ~/.bratrc
  setCurrentContext(contextName);

  // Print confirmation
  if (previousContext && previousContext !== contextName) {
    console.log(`✓ Switched to context '${contextName}' (was '${previousContext}')`);
  } else {
    console.log(`✓ Switched to context '${contextName}'`);
  }

  console.log(`\nAll future brat commands will use this context unless overridden with --context.`);
}

/**
 * Command metadata for help text
 */
export const useCommand = {
  name: 'use',
  description: 'Switch to a different execution context',
  usage: 'brat use <context>',
  examples: [
    'brat use local      # Switch to local development environment',
    'brat use staging    # Switch to staging environment',
    'brat use prod       # Switch to production environment',
  ],
  help: `
Sets the current execution context in ~/.bratrc.

All future brat commands will use this context unless overridden with --context.

This is the PRIMARY workflow for context management:
  1. Run 'brat use <context>' once
  2. All future commands (deploy, chat, fleet, etc.) use that context automatically

Available contexts are defined in architecture.yaml under 'executionContexts'.

Examples:
  brat use local      # Switch to local Docker environment
  brat use staging    # Switch to staging server
  brat use prod       # Switch to production (Cloud Run)

See also:
  brat current        # Show current context
  brat context list   # List all available contexts
`.trim(),
};
