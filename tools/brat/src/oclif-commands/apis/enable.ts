/**
 * brat apis enable
 *
 * Sprint 364: Cloud/Platform command migration (Pattern 1: Simple Delegation)
 *
 * Enable required GCP APIs for BitBrat deployment.
 * Delegates to getRequiredApis() and enableApis() from providers/gcp/apis.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { getRequiredApis, enableApis } from '../../providers/gcp/apis';

export default class ApisEnable extends BratCommand {
  static override description = 'Enable required GCP APIs for BitBrat deployment';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --project-id my-project --dry-run',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(ApisEnable);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';
    const env = this.context.name;

    this.logger.info({
      action: 'apis.enable',
      context: env,
      projectId,
      dryRun: flags['dry-run']
    }, 'Enabling required GCP APIs');

    // Get required APIs list
    const apis = getRequiredApis(env);

    if (flags['dry-run']) {
      this.log(`[DRY-RUN] Would enable ${apis.length} APIs in project: ${projectId}`);
      this.log('');
      this.log('Required APIs:');
      for (const api of apis) {
        this.log(`  - ${api}`);
      }
      return;
    }

    // Enable APIs
    const result = await enableApis({
      projectId,
      env,
      apis,
      dryRun: flags['dry-run']
    });

    // Output results
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    // Human-readable output
    this.log(`Enabling ${result.attempted.length} APIs in project: ${projectId}`);
    this.log('');

    for (const item of result.results) {
      const status = item.enabled ? '✅' : '❌';
      this.log(`${status} ${item.api}`);
      if (!item.enabled && item.error) {
        this.log(`   Error: ${item.error}`);
      }
      if (!item.enabled && item.stderr) {
        this.log(`   ${item.stderr.trim()}`);
      }
    }

    this.log('');
    if (result.ok) {
      this.log('All APIs enabled successfully');
    } else {
      const failedCount = result.results.filter(r => !r.enabled).length;
      this.error(`Failed to enable ${failedCount} API(s)`);
    }
  }
}
