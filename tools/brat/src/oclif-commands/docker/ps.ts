/**
 * brat docker ps
 *
 * Sprint 363: Docker command migration (Pattern 1: Simple Delegation)
 *
 * List running Docker Compose containers (local or remote via SSH).
 * Delegates to DockerOrchestrator.ps()
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator';

export default class DockerPs extends BratCommand {
  static override description = 'List running Docker Compose containers (local or remote via SSH)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --service llm-bot --context staging',
    '<%= config.bin %> <%= command.id %> --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to filter (omit for all services)',
      required: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerPs);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
    });

    this.logger.info({
      action: 'docker.ps',
      context: this.context.name,
      service: flags.service || 'all'
    }, 'Listing Docker Compose containers');

    await orchestrator.ps();
  }
}
