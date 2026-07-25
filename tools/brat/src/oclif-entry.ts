#!/usr/bin/env node

/**
 * oclif Entry Point for brat CLI
 *
 * This is the main entry point for the oclif-based brat CLI.
 * It replaces the legacy tools/brat/src/cli/index.ts.
 *
 * Usage:
 *   node dist/tools/brat/src/oclif-entry.js [command] [args]
 *
 * The oclif framework automatically discovers commands in ./oclif-commands/
 * and generates help text, parses flags, and handles errors.
 */

import { run } from '@oclif/core';

/**
 * Main entry point
 * Runs the oclif CLI and handles errors
 */
async function main(): Promise<void> {
  try {
    // Run oclif with command-line arguments
    // Pass undefined for root since we're using CommonJS and oclif will auto-detect
    await run(process.argv.slice(2));
  } catch (error) {
    // oclif handles most errors internally, but catch any unhandled ones
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Unhandled error during CLI initialization:', error);
  process.exit(1);
});
