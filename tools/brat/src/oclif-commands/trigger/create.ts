/**
 * brat trigger create
 *
 * Sprint 364: Cloud/Platform command migration (Pattern 1: Simple Delegation)
 *
 * Create Cloud Build trigger for GitHub repository.
 * Delegates to createTrigger() from providers/gcp/cloudbuild-triggers.ts
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { createTrigger } from '../../providers/gcp/cloudbuild-triggers';

export default class TriggerCreate extends BratCommand {
  static override description = 'Create Cloud Build trigger for GitHub repository';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-trigger --repo owner/repo',
    '<%= config.bin %> <%= command.id %> deploy-trigger --repo bitbrat/platform --branch main',
    '<%= config.bin %> <%= command.id %> test-trigger --repo owner/repo --config cloudbuild.test.yaml --dry-run',
  ];

  static override args = {
    name: Args.string({
      description: 'Trigger name',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    repo: Flags.string({
      description: 'GitHub repository (owner/repo)',
      required: true,
    }),
    branch: Flags.string({
      description: 'Branch regex pattern',
      default: '.*',
    }),
    config: Flags.string({
      description: 'Cloud Build config path',
      default: 'cloudbuild.yaml',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(TriggerCreate);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    const spec = {
      name: args.name,
      configPath: flags.config,
      substitutions: {},
      repoSource: {
        type: 'github' as const,
        repo: flags.repo,
        branchRegex: flags.branch,
      },
    };

    this.logger.info({
      action: 'trigger.create',
      name: args.name,
      repo: flags.repo,
      branch: flags.branch,
      config: flags.config,
      dryRun: flags['dry-run']
    }, 'Creating Cloud Build trigger');

    const res = await createTrigger(projectId, spec, flags['dry-run']);

    this.log(`${res.action}: ${args.name}`);
  }
}
