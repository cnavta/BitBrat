#!/usr/bin/env node
/*
 * Migration utility: copy legacy Twitch token docs into the new V2 schema
 * Legacy: oauth/twitch/{identity}/token
 * V2:    authTokens/twitch/{identity}
 *
 * Safety:
 *  - Defaults to dry-run
 *  - If FIRESTORE_EMULATOR_HOST not set and --force not provided → no-op
 *  - Never logs access tokens or secrets
 */
import { getFirestore } from '../src/common/firebase';
import { logger } from '../src/common/logging';

type Args = {
  provider: string;
  identities: string[];
  dryRun: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { provider: 'twitch', identities: ['bot', 'broadcaster'], dryRun: true, force: false };
  for (const a of argv.slice(2)) {
    const [k, v] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, ''];
    switch (k) {
      case '--provider': out.provider = (v || 'twitch').toLowerCase(); break;
      case '--identities': out.identities = (v || '').split(/[ ,]+/).map((s) => s.trim()).filter(Boolean); break;
      case '--dry-run': out.dryRun = v === '' ? true : v.toLowerCase() !== 'false'; break;
      case '--no-dry-run': out.dryRun = false; break;
      case '--force': out.force = true; break;
      default: break;
    }
  }
  if (!out.identities.length) out.identities = ['bot', 'broadcaster'];
  return out;
}

function redact(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.length > 0 ? '***REDACTED***' : undefined;
}

async function run() {
  const args = parseArgs(process.argv);

  // Safety: require emulator unless explicitly forced
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!usingEmulator && !args.force) {
    logger.warn('migrate_tokens.emulator_required', { reason: 'FIRESTORE_EMULATOR_HOST not set', mode: 'no-op' });
    return;
  }

  const db = getFirestore();
  const provider = args.provider;
  const identities = args.identities;

  logger.info('migrate_tokens.begin', { provider, identities, dryRun: args.dryRun, emulator: usingEmulator });

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const identity of identities) {
    try {
      // Read legacy doc
      const legacyRef = db.doc(`oauth/${provider}/${identity}/token`);
      const legacySnap = await legacyRef.get();
      if (!legacySnap.exists) {
        logger.info('migrate_tokens.legacy_missing', { provider, identity });
        skipped++;
        continue;
      }
      const legacy = legacySnap.data() as any;

      // Read V2 doc
      const v2Ref = db.doc(`authTokens/${provider}/${identity}`);
      const v2Snap = await v2Ref.get();
      if (v2Snap.exists && (v2Snap.data() as any)?.accessToken) {
        logger.info('migrate_tokens.v2_exists', { provider, identity });
        skipped++;
        continue;
      }

      // Map legacy → v2
      const expiresAt = legacy?.expiresIn && legacy?.obtainmentTimestamp
        ? new Date(legacy.obtainmentTimestamp + legacy.expiresIn * 1000).toISOString()
        : undefined;
      const v2Doc = {
        provider,
        identity,
        tokenType: 'oauth',
        accessToken: legacy?.accessToken,
        refreshToken: legacy?.refreshToken ?? undefined,
        expiresAt,
        scope: Array.isArray(legacy?.scope) ? legacy.scope : [],
        providerUserId: legacy?.userId ?? undefined,
        metadata: undefined as Record<string, unknown> | undefined,
        updatedAt: new Date().toISOString(),
      };

      logger.info('migrate_tokens.plan', {
        provider,
        identity,
        tokenType: v2Doc.tokenType,
        accessToken: redact(v2Doc.accessToken),
        refreshToken: redact(v2Doc.refreshToken),
        expiresAt: v2Doc.expiresAt,
        scopeCount: Array.isArray(v2Doc.scope) ? v2Doc.scope.length : 0,
        providerUserId: v2Doc.providerUserId,
        dryRun: args.dryRun,
      });

      if (!args.dryRun) {
        await v2Ref.set(v2Doc, { merge: true });
      }
      migrated++;
    } catch (e: any) {
      errors++;
      logger.error('migrate_tokens.error', { provider, identity, error: e?.message || String(e) });
    }
  }

  logger.info('migrate_tokens.summary', { provider, migrated, skipped, errors, dryRun: args.dryRun });
}

run().catch((e) => {
  try { logger.error('migrate_tokens.fatal', { error: e?.message || String(e) }); } catch {}
  process.exitCode = 1;
});
