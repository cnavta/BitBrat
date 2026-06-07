import { execCmd } from '../exec';
import { EnvironmentResolver } from './environment-resolver';
import { ComposeFactory } from './compose-factory';
import { PortManager } from './port-manager';
import { loadArchitecture } from '../../config/loader';
import * as fs from 'fs';
import * as path from 'path';

export interface DockerOrchestratorOptions {
  repoRoot: string;
  target?: string;
  env?: string;
  service?: string;
  dryRun?: boolean;
}

export class DockerOrchestrator {
  private readonly envResolver: EnvironmentResolver;
  private readonly composeFactory: ComposeFactory;
  private readonly portManager: PortManager;

  constructor(private readonly options: DockerOrchestratorOptions) {
    this.envResolver = new EnvironmentResolver(options.repoRoot);
    this.composeFactory = new ComposeFactory(options.repoRoot);
    this.portManager = new PortManager();
  }

  public async up(): Promise<void> {
    const { arch, targetConfig, envName } = this.prepare();
    const env = this.envResolver.resolve(envName);
    
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    const assignments = this.portManager.resolvePorts(serviceFiles, env);
    const portOverrides = this.portManager.getEnvOverrides(assignments);

    const mergedEnv = { ...env, ...portOverrides };
    
    // Create temporary .env file for Docker Compose
    const envContent = EnvironmentResolver.flattenToDotEnv(mergedEnv);
    const tempEnvPath = path.join(this.options.repoRoot, `.env.${targetConfig.name || 'docker'}.tmp`);
    
    if (this.options.dryRun) {
      console.log(`[dry-run] Would write temp env file to ${tempEnvPath}`);
      console.log(`[dry-run] Env content:\n${envContent}`);
    } else {
      fs.writeFileSync(tempEnvPath, envContent);
    }

    try {
      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      // Use remote build if it's a remote target and no explicit image is provided in the service compose file
      // Actually, 'docker compose up --build' handles this naturally if DOCKER_HOST is set to an SSH target.
      // It will transfer the context and build on the remote.
      await this.executeDockerCompose(targetConfig, [...composeArgs, 'up', '-d', '--build']);
    } finally {
      if (!this.options.dryRun && fs.existsSync(tempEnvPath)) {
        fs.unlinkSync(tempEnvPath);
      }
    }
  }

  public async down(): Promise<void> {
    const { targetConfig } = this.prepare();
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, []);
    await this.executeDockerCompose(targetConfig, [...composeArgs, 'down']);
  }

  public async logs(follow: boolean = false): Promise<void> {
    const { targetConfig } = this.prepare();
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, []);
    const args = [...composeArgs, 'logs'];
    if (follow) args.push('-f');
    if (this.options.service) args.push(this.options.service.replace(/_/g, '-'));
    await this.executeDockerCompose(targetConfig, args);
  }

  public async ps(): Promise<void> {
    const { targetConfig } = this.prepare();
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, []);
    await this.executeDockerCompose(targetConfig, [...composeArgs, 'ps']);
  }

  private prepare() {
    const arch = loadArchitecture(this.options.repoRoot);
    const targetName = this.options.target || 'local';
    const targetConfig = arch.deploymentTargets?.[targetName];

    if (!targetConfig) {
      throw new Error(`Deployment target '${targetName}' not found in architecture.yaml`);
    }

    const envName = this.options.env || targetConfig.env || 'local';

    return { arch, targetConfig: { ...targetConfig, name: targetName }, envName };
  }

  private async executeDockerCompose(target: any, args: string[]): Promise<void> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    
    if (target.host) {
      env['DOCKER_HOST'] = target.host;
    }
    
    if (target.context) {
      args = ['--context', target.context, ...args];
    }

    const cmd = 'docker';
    const finalArgs = ['compose', '--project-directory', this.options.repoRoot, ...args];

    if (this.options.dryRun) {
      console.log(`[dry-run] Executing: DOCKER_HOST=${env['DOCKER_HOST'] || ''} ${cmd} ${finalArgs.join(' ')}`);
      return;
    }

    await execCmd(cmd, finalArgs, { 
      cwd: this.options.repoRoot,
      env,
      stdio: 'inherit'
    });
  }
}
