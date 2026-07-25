/**
 * Release Command
 *
 * Orchestrates version bumps across the platform.
 * Single source of truth: architecture.yaml project.version
 *
 * Effects (non-dry-run):
 * - Updates architecture.yaml project.version
 * - Updates package.json version
 * - Syncs package-lock.json version
 * - Rolls CHANGELOG.md
 * - Commits changes
 * - Creates git tag (optional)
 * - Pushes to remote (optional)
 * - Creates GitHub PR (optional)
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from './base';
import { runRelease, ReleaseResult } from '../release';
import { ConfigurationError } from '../orchestration/errors';

export default class Release extends BratCommand {
  static description = 'Cut a platform version release';

  static examples = [
    '<%= config.bin %> <%= command.id %> patch',
    '<%= config.bin %> <%= command.id %> minor',
    '<%= config.bin %> <%= command.id %> major',
    '<%= config.bin %> <%= command.id %> 1.0.0',
    '<%= config.bin %> <%= command.id %> patch --dry-run',
    '<%= config.bin %> <%= command.id %> minor --no-tag',
    '<%= config.bin %> <%= command.id %> major --no-push --no-pr',
  ];

  static args = {
    bump: Args.string({
      description: 'Bump type (patch/minor/major) or explicit version (x.y.z)',
      required: true,
    }),
  };

  static flags = {
    ...BratCommand.baseFlags,
    'dry-run': Flags.boolean({
      description: 'Compute and report planned changes without writing anything',
      default: false,
    }),
    'no-tag': Flags.boolean({
      description: 'Skip creating git tag',
      default: false,
    }),
    'no-push': Flags.boolean({
      description: 'Skip pushing changes to remote',
      default: false,
    }),
    'no-pr': Flags.boolean({
      description: 'Skip creating GitHub PR',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip all interactive confirmation prompts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Release);

    // Validate bump argument
    const validBumpTypes = ['patch', 'minor', 'major'];
    const isExplicitVersion = /^\d+\.\d+\.\d+$/.test(args.bump);
    const isValidBumpType = validBumpTypes.includes(args.bump);

    if (!isExplicitVersion && !isValidBumpType) {
      throw new ConfigurationError(
        `Invalid bump argument: '${args.bump}'. Must be one of: patch, minor, major, or explicit x.y.z version.`,
      );
    }

    // Validate: GitHub PRs require git tags
    if (!flags['no-pr'] && flags['no-tag']) {
      throw new ConfigurationError(
        'GitHub PRs require git tags. Remove --no-tag or add --no-pr.',
      );
    }

    this.logger.info(
      {
        bump: args.bump,
        dryRun: flags['dry-run'],
        tag: !flags['no-tag'],
        push: !flags['no-push'],
        createPr: !flags['no-pr'],
      },
      'Starting release',
    );

    try {
      // Run release orchestration
      const result: ReleaseResult = await runRelease({
        rootDir: this.repoRoot,
        bump: args.bump,
        dryRun: flags['dry-run'],
        tag: !flags['no-tag'],
        push: !flags['no-push'],
        createPr: !flags['no-pr'],
        yes: flags.yes,
        logger: this.logger,
      });

      // Display results
      this.displayResults(result, flags['dry-run']);

      // Exit successfully
      if (flags['dry-run']) {
        this.log('');
        this.log('Dry-run complete. No changes were made.');
      } else {
        this.log('');
        this.log(`✓ Release ${result.nextVersion} complete!`);
      }
    } catch (error: any) {
      this.logger.error({ error: error.message, stack: error.stack }, 'Release failed');
      this.error(error.message || 'Release failed', { exit: 1 });
    }
  }

  /**
   * Display release results
   */
  private displayResults(result: ReleaseResult, dryRun: boolean): void {
    const prefix = dryRun ? '[DRY-RUN] ' : '';

    this.log('');
    this.log(`${prefix}Release Summary`);
    this.log('='.repeat(50));
    this.log(`Previous version: ${result.previousVersion}`);
    this.log(`Next version:     ${result.nextVersion}`);
    this.log('');

    if (result.uncommittedChanges) {
      this.log(`${prefix}Uncommitted changes: ${result.changesCommitted ? 'committed' : 'detected'}`);
    }

    this.log(`${prefix}Files updated:`);
    this.log(`  - architecture.yaml (project.version)`);
    this.log(`  - package.json (version)`);
    this.log(`  - package-lock.json (version)`);

    if (result.changelogRolled) {
      this.log(`${prefix}  - CHANGELOG.md (rolled [Unreleased] to [${result.nextVersion}])`);
    }

    this.log('');

    if (!dryRun && result.consistency) {
      this.log('Version consistency check:');
      this.log(`  architecture.yaml: ${result.consistency.architecture}`);
      this.log(`  package.json:      ${result.consistency.packageJson}`);
      this.log(`  package-lock.json: ${result.consistency.packageLock}`);
      this.log(`  ✓ All files consistent`);
      this.log('');
    }

    if (result.changesCommitted) {
      this.log(`${prefix}Changes committed to git`);
    }

    if (result.tagged) {
      this.log(`${prefix}Git tag created: v${result.nextVersion}`);
    }

    if (result.pushed) {
      this.log(`${prefix}Changes pushed to remote`);
    }

    if (result.prCreated && result.prUrl) {
      this.log(`${prefix}GitHub PR created: ${result.prUrl}`);
    }
  }
}
