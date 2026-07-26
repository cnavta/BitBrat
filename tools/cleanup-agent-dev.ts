#!/usr/bin/env node
/**
 * Sprint 358: Cleanup utility for orphaned agent-dev contexts
 *
 * Cleans up all agent-dev execution contexts from:
 * - .brat/ephemeral-contexts.yaml (context registry)
 * - env/agent-dev-* (environment directories)
 * - infrastructure/docker-compose/docker-compose.agent-dev-*.yaml (compose files)
 * - Docker containers and volumes (if running)
 *
 * Usage:
 *   npm run build && node tools/cleanup-agent-dev.ts
 *
 * This is useful for:
 * - Cleaning up after failed tests
 * - Recovering from interrupted operations
 * - Manual cleanup during development
 */

const path = require('path');
const { AgentDevContextManager } = require('../dist/tools/brat/src/dev-mcp/agent-dev-context-manager');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const manager = new AgentDevContextManager(repoRoot);

  console.log('🔍 Scanning for orphaned agent-dev contexts...\n');

  try {
    const cleaned = await manager.cleanupAll();

    if (cleaned.length === 0) {
      console.log('✅ No orphaned agent-dev contexts found');
      console.log('   System is clean!\n');
    } else {
      console.log(`✅ Successfully cleaned up ${cleaned.length} agent-dev context(s)\n`);
      console.log('Cleaned contexts:');
      cleaned.forEach((name: string) => console.log(`   - ${name}`));
      console.log('');
    }

    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error('❌ Cleanup failed:', err.message);
    console.error('\nTry running manually:');
    console.error('  rm -rf ./env/agent-dev-*');
    console.error('  rm -f ./infrastructure/docker-compose/docker-compose.agent-dev-*.yaml');
    console.error('  # Edit .brat/ephemeral-contexts.yaml and remove agent-dev entries\n');
    process.exit(1);
  }
}

main();
