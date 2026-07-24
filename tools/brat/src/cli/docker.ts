import { DockerOrchestrator, DockerOrchestratorOptions } from '../orchestration/docker/orchestrator';
import { ContextResolver } from '../context/context-resolver';
import { getCurrentContext } from '../config/bratrc';

export async function cmdDocker(action: string, flags: any) {
  const repoRoot = process.cwd();

  // Sprint 349: Support --context flag (preferred) or legacy --env/--target flags
  let targetName: string | undefined;
  let envName: string | undefined;
  let contextName: string | undefined;

  // Determine if we should use execution contexts:
  // 1. Explicit --context flag was provided, OR
  // 2. No legacy flags (--target, --env) were provided (use current context from ~/.bratrc)
  const useLegacyMode = !flags.context && (flags.target || flags.env);

  if (!useLegacyMode) {
    // New path: Use execution context
    const resolver = new ContextResolver(repoRoot);
    const resolvedContextName = flags.context || process.env.BITBRAT_CONTEXT || getCurrentContext() || 'local';
    contextName = resolvedContextName;

    // Get raw context to extract envOverlay path
    const rawContext = await resolver.getRawContext(resolvedContextName);
    if (!rawContext) {
      throw new Error(`Context '${contextName}' not found`);
    }

    // Map context to legacy target/env for backward compatibility
    // Until we fully refactor DockerOrchestrator to use execution contexts
    if (rawContext.deployment.type === 'docker-compose') {
      // Create a synthetic target from context
      targetName = `context:${contextName}`;
      envName = rawContext.runtime.envOverlay?.path?.replace('env/', '') || contextName;
    } else {
      throw new Error(`Context '${contextName}' uses deployment type '${rawContext.deployment.type}' which is not supported by 'brat docker'`);
    }
  } else {
    // Legacy path: Use --target and --env flags
    targetName = flags.target;
    envName = flags.env;
  }

  const options: DockerOrchestratorOptions = {
    repoRoot,
    target: targetName,
    env: envName,
    context: contextName, // Pass resolved context name
    service: flags.service,
    dryRun: flags.dryRun,
    loki: flags.loki,
    noDeps: flags.noDeps,
    forceRecreate: flags.forceRecreate,
    noCache: flags.noCache
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
