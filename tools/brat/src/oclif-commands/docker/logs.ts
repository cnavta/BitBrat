/**
 * brat docker logs
 *
 * Sprint 363: Docker command migration (Pattern 1: Simple Delegation)
 *
 * Tail Docker Compose service logs (local or remote via SSH).
 * Delegates to DockerOrchestrator.logs(follow)
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator';

export default class DockerLogs extends BratCommand {
  static override description = 'Tail Docker Compose service logs (local or remote via SSH)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --service llm-bot --context staging',
    '<%= config.bin %> <%= command.id %> --service api-gateway --follow --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to tail (omit for all services)',
      required: false,
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Follow log output (live streaming)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerLogs);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
    });

    this.logger.info({
      action: 'docker.logs',
      context: this.context.name,
      service: flags.service || 'all',
      follow: flags.follow
    }, 'Tailing Docker Compose logs');

    await orchestrator.logs(flags.follow);
  }
}
