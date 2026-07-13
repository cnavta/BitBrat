/**
 * Seed Context Packs into Firestore (P4 RAG Scale-Out, sprint-338)
 *
 * Usage:
 *   npm run brat -- seed-context-packs [--dry-run]
 *
 * This script seeds the context_packs Firestore collection with P3 generated packs
 * (schema.internal-event-v2, router.jsonlogic-guide) plus sample domain-specific packs.
 * Embeddings are generated via OpenAI API or mocked for dev/test environments.
 */

import { getFirestore } from '../../../../src/common/firebase';
import {
  buildInternalEventSchemaPack,
  buildRouterJsonLogicPack,
  embedText,
  buildEmbeddingText,
  type ContextPack,
} from '../../../../src/common/context';
import type { Firestore } from 'firebase-admin/firestore';

interface SeedOptions {
  dryRun?: boolean;
  mockEmbeddings?: boolean;  // Use mock embeddings (fixed vector) instead of OpenAI API
}

/**
 * Generate embedding for pack text. Uses the shared embedText utility (BL-338-202).
 * In dev/test, mock with a deterministic vector. In production, calls OpenAI API.
 */
async function generateEmbedding(text: string, options: SeedOptions): Promise<number[]> {
  if (options.mockEmbeddings) {
    // Mock embedding: deterministic 1536-dim vector based on text hash
    const hash = simpleHash(text);
    return Array.from({ length: 1536 }, (_, i) => Math.sin(hash + i) * 0.001);
  }

  // Production: Use shared embedText utility (with caching)
  const embedding = await embedText(text);

  if (!embedding) {
    // OpenAI API failed; fall back to mock embeddings
    console.warn('embedText failed; falling back to mock embeddings');
    return generateEmbedding(text, { ...options, mockEmbeddings: true });
  }

  return embedding;
}

/** Simple string hash for deterministic mock embeddings */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Upsert a ContextPack into Firestore context_packs collection.
 */
async function upsertPack(
  db: Firestore,
  pack: ContextPack,
  bitName: string,
  options: SeedOptions
): Promise<void> {
  // Use shared buildEmbeddingText utility for consistency (BL-338-202)
  const embeddingText = buildEmbeddingText(pack);
  const embedding = await generateEmbedding(embeddingText, options);

  const packDoc = {
    ...pack,                  // id, version, title, priority, format, body, source
    bitName,
    embedding,                // VectorValue (1536-dim float[])
    embeddingText,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (options.dryRun) {
    console.log(`[DRY RUN] Would upsert pack: ${pack.id}`);
    console.log(`  bitName: ${bitName}`);
    console.log(`  version: ${pack.version}`);
    console.log(`  embeddingDimensions: ${embedding.length}`);
    return;
  }

  const docRef = db.collection('context_packs').doc(pack.id);
  const existing = await docRef.get();

  await docRef.set(
    {
      ...packDoc,
      createdAt: existing.exists ? existing.data()?.createdAt : packDoc.createdAt,
    },
    { merge: true }
  );

  console.log(`✓ Upserted pack: ${pack.id} (bitName: ${bitName}, embedding: ${embedding.length}D)`);
}

/**
 * Seed P3 generated packs (platform-core) + sample domain-specific packs.
 */
export async function seedContextPacks(options: SeedOptions = {}): Promise<void> {
  console.log('=== Seeding Context Packs ===');
  console.log(`Options: dryRun=${options.dryRun}, mockEmbeddings=${options.mockEmbeddings}`);

  const db = getFirestore();

  // P3 Generated Packs (platform-core)
  const schemaPack = buildInternalEventSchemaPack();
  const routerPack = buildRouterJsonLogicPack();

  await upsertPack(db, schemaPack, 'platform-core', options);
  await upsertPack(db, routerPack, 'platform-core', options);

  // Sample Domain-Specific Packs (for testing RAG retrieval)
  const domainPacks: Array<{ pack: ContextPack; bitName: string }> = [
    {
      pack: {
        id: 'scheduler.cron-syntax',
        version: '1',
        title: 'Scheduler Cron Syntax Guide',
        priority: 2,
        format: 'markdown',
        body: `
The \`schedule.value\` field in \`create_schedule\` supports two formats:

**ISO 8601 Duration (one-time):**
- \`+10m\` — 10 minutes from now
- \`+1h\` — 1 hour from now
- \`+1d\` — 1 day from now
- Format: \`+<N><unit>\` where unit is \`s\`, \`m\`, \`h\`, \`d\`, \`w\`

**Cron Expression (recurring):**
- \`0 */5 * * *\` — Every 5 minutes
- \`0 0 * * *\` — Daily at midnight
- \`0 9 * * 1\` — Every Monday at 9am
- Format: \`<minute> <hour> <day> <month> <weekday>\`

Use cron for recurring tasks; use ISO duration for one-time tasks.
        `.trim(),
        source: 'manual/sprint-338-seed',
      },
      bitName: 'scheduler',
    },
    {
      pack: {
        id: 'scheduler.event-definition-guide',
        version: '1',
        title: 'Scheduler EventDefinition Guide',
        priority: 2,
        format: 'markdown',
        body: `
The \`event\` parameter in \`create_schedule\` is a full \`InternalEventV2\`. Key fields:

**type:** The event type (e.g., \`llm.request.v1\`, \`chat.message.v1\`)

**annotations:** Array of \`AnnotationV1\` objects. To schedule a "prompt":
\`\`\`json
{
  "type": "llm.request.v1",
  "annotations": [{
    "id": "<uuid>",
    "kind": "prompt",
    "value": "Your prompt text here",
    "source": "scheduler",
    "createdAt": "<ISO8601>"
  }]
}
\`\`\`

**egress:** Where to deliver the response:
- \`{ connector: 'twitch', destination: 'twitch', channel: '#mychannel' }\` — Twitch chat
- \`{ connector: 'system', destination: 'system' }\` — System event (default)

See \`context://schema/internal-event-v2\` for full contract.
        `.trim(),
        source: 'manual/sprint-338-seed',
      },
      bitName: 'scheduler',
    },
    {
      pack: {
        id: 'router.service-topic-map',
        version: '1',
        title: 'Event Router Service-Topic Mapping',
        priority: 3,
        format: 'markdown',
        body: `
When creating a routing rule, the \`services\` array maps service names to internal topics:

**Service Name → Topic Mapping:**
- \`llm-bot\` → \`internal.llmbot.v1\`
- \`auth\` → \`internal.auth.v1\`
- \`query-analyzer\` → \`internal.query.analysis.v1\`
- \`state-engine\` → \`internal.state.mutation.v1\`
- \`disposition-service\` → \`internal.user.disposition.observation.v1\`

Example rule:
\`\`\`json
{
  "services": ["auth", "llm-bot"],
  "logic": "..."
}
\`\`\`

This creates a routing slip: \`[internal.auth.v1, internal.llmbot.v1]\`.
        `.trim(),
        source: 'manual/sprint-338-seed',
      },
      bitName: 'event-router',
    },
  ];

  for (const { pack, bitName } of domainPacks) {
    await upsertPack(db, pack, bitName, options);
  }

  const totalPacks = 2 + domainPacks.length;
  console.log(`\n=== Seeding Complete ===`);
  console.log(`Total packs: ${totalPacks} (2 platform-core + ${domainPacks.length} domain-specific)`);
  if (options.dryRun) {
    console.log('[DRY RUN] No changes written to Firestore');
  }
}

/**
 * CLI entry point (called via npm run brat -- seed-context-packs)
 */
export async function run(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const mockEmbeddings = args.includes('--mock-embeddings') || !process.env.OPENAI_API_KEY;

  try {
    await seedContextPacks({ dryRun, mockEmbeddings });
    process.exit(0);
  } catch (error: any) {
    console.error('Seed failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Auto-run if invoked directly
if (require.main === module) {
  run(process.argv.slice(2));
}
