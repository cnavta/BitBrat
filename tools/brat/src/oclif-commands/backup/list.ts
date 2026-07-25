/**
 * brat backup list
 *
 * Sprint 361: Backup command migration (Pattern 1: Simple Delegation)
 *
 * Lists the backup registry (allowlist of collections that can be backed up).
 * No database access - reads from in-memory registry.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { CONFIG_BACKUP_REGISTRY, FORBIDDEN_PREFIXES, assertRegistrySafe } from '../../backup/registry';

export default class BackupList extends BratCommand {
  static override description = 'List backup registry (allowlisted collections)';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(BackupList);

    // Validate registry safety
    assertRegistrySafe();

    if (flags.json) {
      this.log(JSON.stringify({
        registryVersionNote: 'config-only allowlist; log/event collections are never exported',
        forbiddenPrefixes: FORBIDDEN_PREFIXES,
        collections: CONFIG_BACKUP_REGISTRY,
      }, null, 2));
      return;
    }

    // Human-readable output
    this.log('brat backup — config collection registry (allowlist; log/event collections are NEVER exported)\n');

    for (const spec of CONFIG_BACKUP_REGISTRY) {
      const flagsStr = [
        spec.sensitive ? 'sensitive (opt-in --include-secrets)' : '',
        spec.recurseSubcollections === false ? 'no-recurse' : 'recurse-subcollections',
        spec.stripFields && spec.stripFields.length ? `strip: ${spec.stripFields.join(', ')}` : '',
      ].filter(Boolean).join('; ');

      this.log(`  • ${spec.path}`);
      this.log(`      ${spec.rationale}`);
      if (flagsStr) this.log(`      [${flagsStr}]`);
    }

    this.log(`\nExcluded (FORBIDDEN_PREFIXES, never backed up): ${FORBIDDEN_PREFIXES.join(', ')}`);
  }
}
