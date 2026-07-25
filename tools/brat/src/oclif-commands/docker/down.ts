/**
 * brat docker down
 *
 * Sprint 363: Docker command migration (Pattern 1: Simple Delegation)
 *
 * Stop Docker Compose stack (local or remote via SSH).
 * Delegates to DockerOrchestrator.down()
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator';

export default class DockerDown extends BratCommand {
  static override description = 'Stop Docker Compose stack (local or remote via SSH)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --service llm-bot --context staging',
    '<%= config.bin %> <%= command.id %> --dry-run --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to stop (omit for all services)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerDown);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
      dryRun: flags['dry-run'],
    });

    this.logger.info({
      action: 'docker.down',
      context: this.context.name,
      service: flags.service || 'all',
      dryRun: flags['dry-run']
    }, 'Stopping Docker Compose stack');

    await orchestrator.down();

    if (!flags['dry-run']) {
      this.log(`✅ Docker Compose stack stopped`);
    }
  }
}
