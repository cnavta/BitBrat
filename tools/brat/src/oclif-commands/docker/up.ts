/**
 * brat docker up
 *
 * Sprint 363: Docker command migration (Pattern 1: Simple Delegation)
 *
 * Start Docker Compose stack (local or remote via SSH).
 * Delegates to DockerOrchestrator.up()
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator';

export default class DockerUp extends BratCommand {
  static override description = 'Start Docker Compose stack (local or remote via SSH)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --service llm-bot --context staging',
    '<%= config.bin %> <%= command.id %> --loki --context dev',
    '<%= config.bin %> <%= command.id %> --force-recreate --context local',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to start (omit for all active services)',
      required: false,
    }),
    loki: Flags.boolean({
      description: 'Enable Loki + Promtail observability stack',
      default: false,
    }),
    'no-deps': Flags.boolean({
      description: 'Skip starting linked services (docker compose up --no-deps)',
      default: false,
    }),
    'force-recreate': Flags.boolean({
      description: 'Force recreate containers even if config unchanged',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build images without using cache',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerUp);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
      loki: flags.loki,
      noDeps: flags['no-deps'],
      forceRecreate: flags['force-recreate'],
      noCache: flags['no-cache'],
      dryRun: flags['dry-run'],
    });

    this.logger.info({
      action: 'docker.up',
      context: this.context.name,
      service: flags.service || 'all',
      loki: flags.loki,
      noDeps: flags['no-deps'],
      forceRecreate: flags['force-recreate'],
      dryRun: flags['dry-run']
    }, 'Starting Docker Compose stack');

    await orchestrator.up();

    if (!flags['dry-run']) {
      this.log(`✅ Docker Compose stack started`);
    }
  }
}
