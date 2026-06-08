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
    const tempEnvPath = this.writeEnvFile(envName, targetConfig);
    
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);

    try {
      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      
      const isRemote = targetConfig.host?.startsWith('ssh://');
      const maxConcurrent = arch.deploymentDefaults?.maxConcurrentDeployments || 3;
      const services = serviceFiles.map(f => path.basename(f, '.compose.yaml'));

      if (isRemote) {
        console.log(`[brat] Remote target detected. Deploying ${services.length} services in batches of ${maxConcurrent}...`);
        
        // Build in batches to avoid hitting SSH connection limits
        for (let i = 0; i < services.length; i += maxConcurrent) {
          const batch = services.slice(i, i + maxConcurrent);
          console.log(`[brat] Building batch: ${batch.join(', ')}`);
          await this.executeDockerCompose(targetConfig, [...composeArgs, 'build', ...batch]);
        }
        
        // Up in batches to prevent overwhelming the remote engine with simultaneous checks/starts
        for (let i = 0; i < services.length; i += maxConcurrent) {
          const batch = services.slice(i, i + maxConcurrent);
          console.log(`[brat] Starting batch: ${batch.join(', ')}`);
          await this.executeDockerCompose(targetConfig, [...composeArgs, 'up', '-d', '--no-build', ...batch]);
        }

        // Final pass to ensure everything is up and correctly linked
        await this.executeDockerCompose(targetConfig, [...composeArgs, 'up', '-d', '--no-build']);
      } else {
        await this.executeDockerCompose(targetConfig, [...composeArgs, 'up', '-d', '--build']);
      }
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  public async down(): Promise<void> {
    const { targetConfig, envName } = this.prepare();
    const tempEnvPath = this.writeEnvFile(envName, targetConfig);
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      await this.executeDockerCompose(targetConfig, [...composeArgs, 'down']);
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  public async logs(follow: boolean = false): Promise<void> {
    const { targetConfig, envName } = this.prepare();
    const tempEnvPath = this.writeEnvFile(envName, targetConfig);
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      const args = [...composeArgs, 'logs'];
      if (follow) args.push('-f');
      if (this.options.service) args.push(this.options.service.replace(/_/g, '-'));
      await this.executeDockerCompose(targetConfig, args);
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  public async ps(): Promise<void> {
    const { targetConfig, envName } = this.prepare();
    const tempEnvPath = this.writeEnvFile(envName, targetConfig);
    const { baseFile, serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      await this.executeDockerCompose(targetConfig, [...composeArgs, 'ps']);
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  private writeEnvFile(envName: string, targetConfig: any): string {
    const env = this.envResolver.resolve(envName);
    const { serviceFiles } = this.composeFactory.getComposeFiles(this.options.service);
    const assignments = this.portManager.resolvePorts(serviceFiles, env);
    const portOverrides = this.portManager.getEnvOverrides(assignments);
    const mergedEnv = { ...env, ...portOverrides };

    const envContent = EnvironmentResolver.flattenToDotEnv(mergedEnv);
    const tempEnvPath = path.join(this.options.repoRoot, '.env.brat');

    if (this.options.dryRun) {
      console.log(`[dry-run] Would write env file to ${tempEnvPath}`);
    } else {
      fs.writeFileSync(tempEnvPath, envContent);
    }
    return tempEnvPath;
  }

  private cleanupEnvFile(tempEnvPath: string): void {
    if (!this.options.dryRun && fs.existsSync(tempEnvPath)) {
      fs.unlinkSync(tempEnvPath);
    }
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
    const arch = loadArchitecture(this.options.repoRoot);
    const maxConcurrent = arch.deploymentDefaults?.maxConcurrentDeployments || 3;

    const env: Record<string, string> = { 
      ...process.env as Record<string, string>,
      COMPOSE_PARALLEL_LIMIT: maxConcurrent.toString()
    };
    
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
