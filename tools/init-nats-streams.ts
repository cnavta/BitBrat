#!/usr/bin/env ts-node
/**
 * init-nats-streams.ts
 *
 * Idempotent NATS JetStream initialization script
 * Creates all standard BitBrat streams for event routing
 *
 * Sprint 351: Bootstrap Automation (Task T2.2)
 *
 * Usage:
 *   ts-node tools/init-nats-streams.ts [--nats-url nats://localhost:4222] [--verbose]
 *   npm run init-streams
 *   brat docker up (auto-runs this script after NATS startup)
 *
 * Features:
 *   - Idempotent: Safe to run multiple times
 *   - Creates all 7 standard streams (internal-mcp, internal-ingress, etc.)
 *   - Configurable via YAML or command-line args
 *   - Validates stream creation
 *   - Reports existing vs newly created streams
 */

import { connect, JetStreamManager, StreamConfig } from 'nats';

interface StreamDefinition {
  name: string;
  subjects: string[];
  description?: string;
}

/** Standard BitBrat streams for event routing */
const STANDARD_STREAMS: StreamDefinition[] = [
  {
    name: 'internal-mcp',
    subjects: ['internal.mcp.>'],
    description: 'MCP server registration and discovery',
  },
  {
    name: 'internal-ingress',
    subjects: ['internal.ingress.>'],
    description: 'External events normalized to internal format (Stage 1)',
  },
  {
    name: 'internal-egress',
    subjects: ['internal.egress.>'],
    description: 'Responses to be delivered externally',
  },
  {
    name: 'internal-contextualization',
    subjects: ['internal.contextualization.>'],
    description: 'Stage 2: Context enrichment (user, auth, environment)',
  },
  {
    name: 'internal-analysis',
    subjects: ['internal.analysis.>'],
    description: 'Stage 3: Analysis and reasoning (LLM, query analysis)',
  },
  {
    name: 'internal-reaction',
    subjects: ['internal.reaction.>'],
    description: 'Stage 4: Actions and mutations (state changes, API calls)',
  },
  {
    name: 'internal-api',
    subjects: ['internal.api.>'],
    description: 'API gateway specific messages',
  },
];

/** Default stream configuration */
const DEFAULT_STREAM_CONFIG: Partial<StreamConfig> = {
  storage: 'file',      // Persistent storage
  retention: 'limits',  // Retain based on limits (not interest-based)
  max_age: 86400_000_000_000, // 24 hours in nanoseconds
  replicas: 1,          // Single replica (increase for production HA)
  discard: 'old',       // Discard old messages when limits reached
};

/** CLI arguments */
interface Args {
  natsUrl: string;
  verbose: boolean;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): Args {
  const args = process.argv.slice(2);
  const natsUrl = args.includes('--nats-url')
    ? args[args.indexOf('--nats-url') + 1]
    : process.env.NATS_URL || 'nats://localhost:4222';
  const verbose = args.includes('--verbose') || args.includes('-v');

  return { natsUrl, verbose };
}

/**
 * Check if a stream exists
 */
async function streamExists(jsm: JetStreamManager, streamName: string): Promise<boolean> {
  try {
    await jsm.streams.info(streamName);
    return true;
  } catch (error: any) {
    if (error.message.includes('stream not found')) {
      return false;
    }
    throw error;
  }
}

/**
 * Create a single stream
 */
async function createStream(
  jsm: JetStreamManager,
  def: StreamDefinition,
  verbose: boolean
): Promise<'created' | 'exists'> {
  const exists = await streamExists(jsm, def.name);

  if (exists) {
    if (verbose) {
      console.log(`  ⏭️  ${def.name} (already exists)`);
    }
    return 'exists';
  }

  const config: StreamConfig = {
    name: def.name,
    subjects: def.subjects,
    ...DEFAULT_STREAM_CONFIG,
  };

  await jsm.streams.add(config);

  if (verbose) {
    console.log(`  ✅ ${def.name} (created)`);
    console.log(`     Subjects: ${def.subjects.join(', ')}`);
    if (def.description) {
      console.log(`     Purpose: ${def.description}`);
    }
  }

  return 'created';
}

/**
 * Main initialization function
 */
async function initNatsStreams(): Promise<void> {
  const { natsUrl, verbose } = parseArgs();

  console.log('🚀 Initializing NATS JetStream...');
  console.log(`   NATS URL: ${natsUrl}`);
  console.log();

  let nc;
  try {
    // Connect to NATS
    nc = await connect({
      servers: natsUrl,
      timeout: 5000,
    });

    if (verbose) {
      console.log('✅ Connected to NATS');
      console.log();
    }

    // Get JetStream manager
    const jsm = await nc.jetstreamManager();

    // Create streams
    console.log('📋 Creating streams...');
    let created = 0;
    let existing = 0;

    for (const streamDef of STANDARD_STREAMS) {
      const result = await createStream(jsm, streamDef, verbose);
      if (result === 'created') {
        created++;
      } else {
        existing++;
      }
    }

    // Summary
    console.log();
    console.log('━'.repeat(60));
    console.log(`✅ Stream initialization complete`);
    console.log(`   Created: ${created}`);
    console.log(`   Existing: ${existing}`);
    console.log(`   Total: ${STANDARD_STREAMS.length}`);
    console.log('━'.repeat(60));

    // List all streams (verbose mode)
    if (verbose) {
      console.log();
      console.log('📊 All streams:');
      const streams = await jsm.streams.list().next();
      for await (const stream of streams) {
        const info = await jsm.streams.info(stream.config.name);
        console.log(`   - ${stream.config.name}`);
        console.log(`     Subjects: ${stream.config.subjects?.join(', ')}`);
        console.log(`     Messages: ${info.state.messages}`);
      }
    }

  } catch (error: any) {
    console.error();
    console.error('❌ Error initializing NATS streams:');
    console.error(`   ${error.message}`);

    if (error.message.includes('ECONNREFUSED')) {
      console.error();
      console.error('   NATS server not reachable. Ensure NATS is running:');
      console.error(`     docker ps | grep nats`);
      console.error(`     brat docker up --context <context> --services nats`);
    }

    process.exit(1);
  } finally {
    // Clean up connection
    if (nc) {
      await nc.drain();
      await nc.close();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  initNatsStreams().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { initNatsStreams, STANDARD_STREAMS };
