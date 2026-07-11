import { DockerOrchestrator, DockerOrchestratorOptions } from '../orchestration/docker/orchestrator';

export async function cmdDocker(action: string, flags: any) {
  const options: DockerOrchestratorOptions = {
    repoRoot: process.cwd(),
    target: flags.target,
    env: flags.env,
    service: flags.service,
    dryRun: flags.dryRun,
    loki: flags.loki
  };

  const orchestrator = new DockerOrchestrator(options);

  switch (action) {
    case 'up':
      await orchestrator.up();
      break;
    case 'down':
      await orchestrator.down();
      break;
    case 'logs':
      await orchestrator.logs(flags.follow);
      break;
    case 'ps':
      await orchestrator.ps();
      break;
    default:
      throw new Error(`Unknown docker action: ${action}`);
  }
}
