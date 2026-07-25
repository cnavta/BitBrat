/**
 * brat trigger delete
 *
 * Sprint 364: Cloud/Platform command migration (Pattern 1: Simple Delegation)
 *
 * Delete Cloud Build trigger.
 * Delegates to deleteTrigger() from providers/gcp/cloudbuild-triggers.ts
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { deleteTrigger } from '../../providers/gcp/cloudbuild-triggers';

export default class TriggerDelete extends BratCommand {
  static override description = 'Delete Cloud Build trigger';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-trigger',
    '<%= config.bin %> <%= command.id %> old-trigger --dry-run',
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
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(TriggerDelete);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    this.logger.info({
      action: 'trigger.delete',
      name: args.name,
      dryRun: flags['dry-run']
    }, 'Deleting Cloud Build trigger');

    const res = await deleteTrigger(projectId, args.name, flags['dry-run']);

    this.log(`${res.action}: ${args.name}`);
  }
}
