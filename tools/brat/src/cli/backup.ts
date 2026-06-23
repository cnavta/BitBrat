import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../orchestration/logger';
import { ConfigurationError } from '../orchestration/errors';
import { CONFIG_BACKUP_REGISTRY, FORBIDDEN_PREFIXES, assertRegistrySafe } from '../backup/registry';
import { getBackupFirestore } from '../providers/gcp/firestore';
import { resolveBackupConnection } from '../backup/connection';
import { exportConfig } from '../backup/export';
import { importConfig, ImportMode } from '../backup/import';

export interface BackupCliFlags {
  projectId?: string;
  env?: string;
  json?: boolean;
  dryRun?: boolean;
}

/** Parse the residual `--k v` / `--flag` tokens (already normalised to `--k=v` by parseArgs). */
function parseFlagMap(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    out[key] = v !== undefined ? v : 'true';
  }
  return out;
}

function parseCsv(value?: string): string[] | undefined {
  if (!value || value === 'true') return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function isTrue(v?: string): boolean {
  return v === 'true' || v === '1' || v === 'yes';
}

/** `brat backup list` — print the registry + rationale; no DB access. */
function cmdBackupList(flags: BackupCliFlags): void {
  assertRegistrySafe();
  if (flags.json) {
    console.log(JSON.stringify({
      registryVersionNote: 'config-only allowlist; log/event collections are never exported',
      forbiddenPrefixes: FORBIDDEN_PREFIXES,
      collections: CONFIG_BACKUP_REGISTRY,
    }, null, 2));
    return;
  }
  console.log('brat backup — config collection registry (allowlist; log/event collections are NEVER exported)\n');
  for (const spec of CONFIG_BACKUP_REGISTRY) {
    const flagsStr = [
      spec.sensitive ? 'sensitive (opt-in --include-secrets)' : '',
      spec.recurseSubcollections === false ? 'no-recurse' : 'recurse-subcollections',
      spec.stripFields && spec.stripFields.length ? `strip: ${spec.stripFields.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    console.log(`  • ${spec.path}`);
    console.log(`      ${spec.rationale}`);
    if (flagsStr) console.log(`      [${flagsStr}]`);
  }
  console.log(`\nExcluded (FORBIDDEN_PREFIXES, never backed up): ${FORBIDDEN_PREFIXES.join(', ')}`);
}

function defaultOutPath(projectId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), `bitbrat-config-backup-${projectId}-${stamp}.json`);
}

/** `brat backup export` — read-only envelope writer. */
async function cmdBackupExport(flags: BackupCliFlags, m: Record<string, string>, logger: Logger): Promise<void> {
  const conn = await resolveBackupConnection({ projectId: flags.projectId, env: flags.env }, m, logger);
  logger.info({ action: 'backup.export.target', target: conn.description }, `Export target: ${conn.description}`);
  const { db, target } = getBackupFirestore(conn.connectOptions, logger);
  try {
    const result = await exportConfig(db, target, {
      collections: parseCsv(m['collections']),
      includeSecrets: isTrue(m['include-secrets']),
    }, logger);

    const json = (isTrue(m['pretty']) || flags.json)
      ? JSON.stringify(result.envelope, null, 2)
      : JSON.stringify(result.envelope);

    if (flags.json && !m['out']) {
      // Stream the envelope to stdout.
      console.log(json);
    } else {
      const outPath = (m['out'] && m['out'] !== 'true') ? m['out'] : defaultOutPath(target.projectId);
      fs.writeFileSync(outPath, json, 'utf8');
      logger.info({ action: 'backup.export.written', outPath, documents: result.documentCount,
        collections: result.envelope.metadata.collectionCount }, `Wrote backup to ${outPath}`);
      console.log(`Exported ${result.documentCount} document(s) across ${result.envelope.metadata.collectionCount} collection(s) → ${outPath}`);
      if (!result.envelope.metadata.includeSecrets) {
        console.log('Note: sensitive collections were excluded (re-run with --include-secrets to include them).');
      }
    }
  } finally {
    if (conn.cleanup) await conn.cleanup();
  }
}

/** `brat backup import` — dry-run by default; --confirm to write. */
async function cmdBackupImport(flags: BackupCliFlags, m: Record<string, string>, logger: Logger): Promise<void> {
  const inPath = m['in'];
  if (!inPath || inPath === 'true') {
    throw new ConfigurationError('Usage: brat backup import --in <path> [--target <name> | --project-id <id>] [--mode merge|overwrite|skip] [--confirm]');
  }
  if (!fs.existsSync(inPath)) {
    throw new ConfigurationError(`Backup file not found: ${inPath}`);
  }
  const mode = (m['mode'] && m['mode'] !== 'true' ? m['mode'] : 'merge') as ImportMode;
  if (!['merge', 'overwrite', 'skip'].includes(mode)) {
    throw new ConfigurationError(`Invalid --mode '${mode}'; expected merge|overwrite|skip.`);
  }
  // --dry-run forces dry-run; otherwise a real write requires --confirm.
  const confirm = isTrue(m['confirm']) && !flags.dryRun;

  const conn = await resolveBackupConnection({ projectId: flags.projectId, env: flags.env }, m, logger);

  // Safety rail (TA §7.2): a real write into a real GCP database must name the project explicitly.
  if (confirm && !conn.isEmulator && !m['project-id']) {
    throw new ConfigurationError(
      'Refusing a real GCP import without an explicit --project-id (safety check). ' +
      'Re-run with --project-id <id> to confirm the destination, or use --target for an emulator stack.',
    );
  }
  logger.info({ action: 'backup.import.target', target: conn.description, dryRun: !confirm, mode },
    `Import target: ${conn.description} [${confirm ? 'WRITE' : 'dry-run'}, mode=${mode}]`);

  const envelope = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const { db } = getBackupFirestore(conn.connectOptions, logger);
  try {
    const result = await importConfig(db, envelope, {
      mode,
      collections: parseCsv(m['collections']),
      includeSecrets: isTrue(m['include-secrets']),
      confirm,
    }, logger);

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.dryRun ? '[DRY-RUN] ' : ''}Import target: ${conn.description}`);
      console.log(`Mode: ${result.mode}; total write op(s) ${result.dryRun ? 'planned' : 'issued'}: ${result.totalOps}`);
      for (const [col, s] of Object.entries(result.perCollection)) {
        console.log(`  ${col}: create ${s.created}, update ${s.updated}, skip ${s.skipped}`);
      }
      for (const w of result.warnings) console.log(`  ! ${w}`);
      if (result.dryRun) {
        console.log('\nThis was a dry-run. Re-run with --confirm to apply the changes.');
      }
    }
  } finally {
    if (conn.cleanup) await conn.cleanup();
  }
}

export async function cmdBackup(action: string | undefined, flags: BackupCliFlags, rest: string[], logger: Logger): Promise<void> {
  const m = parseFlagMap(rest);
  switch (action) {
    case 'list':
      cmdBackupList(flags);
      return;
    case 'export':
      await cmdBackupExport(flags, m, logger);
      return;
    case 'import':
      await cmdBackupImport(flags, m, logger);
      return;
    default:
      console.error('Usage: brat backup <list|export|import> [options]');
      process.exit(2);
  }
}
