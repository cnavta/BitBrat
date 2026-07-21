/**
 * Sprint 352: Firestore Seed Writer
 *
 * Story S6.3: Write seed data to Firestore (backwards compatibility).
 * Supports idempotent seeding with merge mode.
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { SeedDataSet, SeedingOptions } from './seed-data-types';
import { generateSeedData } from './seed-data-definitions';

/**
 * Seed result (same interface as postgres-seed-writer)
 */
export interface SeedResult {
  success: boolean;
  message: string;
  counts: {
    routingRules: number;
    reflexes: number;
    personalities: number;
    contextPacks: number;
    apiTokens: number;
  };
  errors?: string[];
}

/**
 * Seed Firestore database with initial data
 *
 * @param firestore - Firestore instance
 * @param options - Seeding options
 * @returns Seed result
 */
export async function seedFirestore(
  firestore: Firestore,
  options: SeedingOptions = {}
): Promise<SeedResult> {
  const errors: string[] = [];

  try {
    // Generate seed data
    const seedData = generateSeedData(options);

    if (options.dryRun) {
      console.log('[DRY RUN] Would seed:');
      console.log(`  - ${seedData.routingRules.length} routing rules`);
      console.log(`  - ${seedData.reflexes.length} reflexes`);
      console.log(`  - ${seedData.personalities.length} personalities`);
      console.log(`  - ${seedData.contextPacks.length} context packs`);
      console.log(`  - ${seedData.apiTokens.length} API tokens`);

      return {
        success: true,
        message: 'Dry run completed',
        counts: {
          routingRules: seedData.routingRules.length,
          reflexes: seedData.reflexes.length,
          personalities: seedData.personalities.length,
          contextPacks: seedData.contextPacks.length,
          apiTokens: seedData.apiTokens.length,
        },
      };
    }

    // Use batch writes for atomicity
    const batch = firestore.batch();

    // Wipe existing data if requested
    if (options.wipe) {
      await wipeExistingData(firestore);
    }

    // Seed routing rules
    await seedRoutingRules(firestore, seedData, batch);

    // Seed reflexes
    await seedReflexes(firestore, seedData, batch);

    // Seed personalities
    await seedPersonalities(firestore, seedData, batch);

    // Seed context packs
    await seedContextPacks(firestore, seedData, batch);

    // Seed API tokens
    await seedApiTokens(firestore, seedData, batch);

    // Commit batch
    await batch.commit();

    return {
      success: true,
      message: 'Seed data written successfully',
      counts: {
        routingRules: seedData.routingRules.length,
        reflexes: seedData.reflexes.length,
        personalities: seedData.personalities.length,
        contextPacks: seedData.contextPacks.length,
        apiTokens: seedData.apiTokens.length,
      },
    };
  } catch (error: any) {
    errors.push(error.message || String(error));
    return {
      success: false,
      message: `Seeding failed: ${error.message}`,
      counts: {
        routingRules: 0,
        reflexes: 0,
        personalities: 0,
        contextPacks: 0,
        apiTokens: 0,
      },
      errors,
    };
  }
}

/**
 * Wipe existing seed data (for --wipe option)
 */
async function wipeExistingData(firestore: Firestore): Promise<void> {
  // Routing rules
  const routingRulesSnap = await firestore.collection('configs/routingRules/rules').get();
  const batch1 = firestore.batch();
  routingRulesSnap.docs.forEach(doc => batch1.delete(doc.ref));
  await batch1.commit();

  // Reflexes
  const reflexesSnap = await firestore.collection('reflexes').get();
  const batch2 = firestore.batch();
  reflexesSnap.docs.forEach(doc => batch2.delete(doc.ref));
  await batch2.commit();

  // Personalities
  const personalitiesSnap = await firestore.collection('personalities').get();
  const batch3 = firestore.batch();
  personalitiesSnap.docs.forEach(doc => batch3.delete(doc.ref));
  await batch3.commit();

  // Context packs
  const packsSnap = await firestore.collection('context_packs').get();
  const batch4 = firestore.batch();
  packsSnap.docs.forEach(doc => batch4.delete(doc.ref));
  await batch4.commit();

  // API tokens
  const tokensSnap = await firestore.collection('gateways/api/tokens').get();
  const batch5 = firestore.batch();
  tokensSnap.docs.forEach(doc => batch5.delete(doc.ref));
  await batch5.commit();
}

/**
 * Seed routing rules
 */
async function seedRoutingRules(
  firestore: Firestore,
  seedData: SeedDataSet,
  batch: FirebaseFirestore.WriteBatch
): Promise<void> {
  for (const rule of seedData.routingRules) {
    const docRef = firestore.collection('configs/routingRules/rules').doc(rule.id);
    batch.set(
      docRef,
      {
        enabled: rule.enabled,
        priority: rule.priority,
        description: rule.description,
        logic: rule.logic,
        routing: rule.routing,
        enrichments: rule.enrichments || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

/**
 * Seed reflexes
 */
async function seedReflexes(
  firestore: Firestore,
  seedData: SeedDataSet,
  batch: FirebaseFirestore.WriteBatch
): Promise<void> {
  for (const reflex of seedData.reflexes) {
    const docRef = firestore.collection('reflexes').doc(reflex.id);
    batch.set(
      docRef,
      {
        name: reflex.name,
        tags: reflex.tags,
        match: reflex.match,
        active: reflex.active,
        priority: reflex.priority,
        conditions: reflex.conditions,
        description: reflex.description,
        candidateTemplate: reflex.candidateTemplate,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

/**
 * Seed personalities
 */
async function seedPersonalities(
  firestore: Firestore,
  seedData: SeedDataSet,
  batch: FirebaseFirestore.WriteBatch
): Promise<void> {
  for (const personality of seedData.personalities) {
    const docRef = firestore.collection('personalities').doc(personality.id);
    batch.set(
      docRef,
      {
        name: personality.name,
        text: personality.text,
        status: personality.status,
        version: personality.version,
        tags: personality.tags || [],
        platform: personality.platform,
        model: personality.model,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

/**
 * Seed context packs
 */
async function seedContextPacks(
  firestore: Firestore,
  seedData: SeedDataSet,
  batch: FirebaseFirestore.WriteBatch
): Promise<void> {
  for (const pack of seedData.contextPacks) {
    const docRef = firestore.collection('context_packs').doc(pack.id);
    batch.set(
      docRef,
      {
        version: pack.version,
        title: pack.title,
        priority: pack.priority,
        format: pack.format,
        source: pack.source,
        content: pack.content,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

/**
 * Seed API tokens
 */
async function seedApiTokens(
  firestore: Firestore,
  seedData: SeedDataSet,
  batch: FirebaseFirestore.WriteBatch
): Promise<void> {
  for (const token of seedData.apiTokens) {
    // Use tokenHash as document ID for consistency with PostgreSQL
    const docRef = firestore.collection('gateways/api/tokens').doc(token.tokenHash);
    batch.set(
      docRef,
      {
        tokenHash: token.tokenHash,
        userId: token.userId,
        description: token.description,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}
