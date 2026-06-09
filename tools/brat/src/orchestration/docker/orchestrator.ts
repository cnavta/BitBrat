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
      await this.ensureRemoteSynced(targetConfig);

      const composeArgs = this.composeFactory.buildComposeArgs({ baseFile, serviceFiles }, [tempEnvPath]);
      const isRemote = targetConfig.host?.startsWith('ssh://');
      let maxConcurrent = targetConfig.maxConcurrent || arch.deploymentDefaults?.maxConcurrentDeployments || 3;
      if (isRemote && !targetConfig.maxConcurrent) {
        maxConcurrent = 1; // Default to 1 for SSH if not specified, to avoid "only one connection allowed"
      }
      
      const services = serviceFiles.map(f => path.basename(f, '.compose.yaml'));

      if (isRemote) {
        console.log(`[brat] Remote target detected (concurrency: ${maxConcurrent}). Deploying ${services.length} services in batches...`);
        
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
      await this.ensureRemoteSynced(targetConfig);
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
      await this.ensureRemoteSynced(targetConfig);
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
      await this.ensureRemoteSynced(targetConfig);
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
    const tempEnvPath = '.env.brat';
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);

    if (this.options.dryRun) {
      console.log(`[dry-run] Would write env file to ${fullEnvPath}`);
    } else {
      fs.writeFileSync(fullEnvPath, envContent);
    }
    return tempEnvPath;
  }

  private cleanupEnvFile(tempEnvPath: string): void {
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);
    if (!this.options.dryRun && fs.existsSync(fullEnvPath)) {
      fs.unlinkSync(fullEnvPath);
    }
  }

  private async ensureRemoteSynced(targetConfig: any): Promise<void> {
    const isRemote = targetConfig.host?.startsWith('ssh://');
    if (isRemote && targetConfig.remoteDir) {
      await this.syncRemoteFiles(targetConfig);
    }
  }

  private async syncRemoteFiles(target: any): Promise<void> {
    const remoteDir = target.remoteDir;
    if (!remoteDir) return;

    // Extract user@host from ssh://user@host
    const sshTarget = target.host.replace('ssh://', '');
    
    console.log(`[brat] Syncing deployment files to remote: ${sshTarget}:${remoteDir}`);

    // Create remote directory
    await execCmd('ssh', [sshTarget, `mkdir -p ${remoteDir}`], { cwd: this.options.repoRoot });

    // Sync essential files for Docker Compose
    // We sync infrastructure/docker-compose, .env.brat, and dummy-creds.json (if exists)
    const filesToSync = [
      'infrastructure/docker-compose',
      '.env.brat',
      'dummy-creds.json'
    ];

    for (const file of filesToSync) {
      const localPath = path.join(this.options.repoRoot, file);
      if (fs.existsSync(localPath)) {
        await execCmd('rsync', ['-az', '--delete', file, `${sshTarget}:${remoteDir}/`], { cwd: this.options.repoRoot });
      }
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
    let maxConcurrent = target.maxConcurrent || arch.deploymentDefaults?.maxConcurrentDeployments || 3;
    
    if (target.host?.startsWith('ssh://') && !target.maxConcurrent) {
      maxConcurrent = 1;
    }

    const env: Record<string, string> = { 
      ...process.env as Record<string, string>,
      COMPOSE_PARALLEL_LIMIT: maxConcurrent.toString()
    };
    
    const cmd = 'docker';
    const globalArgs: string[] = [];
    if (target.context) {
      globalArgs.push('--context', target.context);
      delete env['DOCKER_HOST'];
    } else if (target.host) {
      env['DOCKER_HOST'] = target.host;
    }

    // Use relative path for --project-directory to be more portable across environments
    // If it's a remote target with a remoteDir, we use the remoteDir as project directory
    const projectDir = (target.host?.startsWith('ssh://') && target.remoteDir) ? target.remoteDir : '.';
    const finalArgs = [...globalArgs, 'compose', '--project-directory', projectDir, ...args];

    if (this.options.dryRun) {
      console.log(`[dry-run] Executing: ${env['DOCKER_HOST'] ? `DOCKER_HOST=${env['DOCKER_HOST']} ` : ''}${cmd} ${finalArgs.join(' ')}`);
      return;
    }

    await execCmd(cmd, finalArgs, { 
      cwd: this.options.repoRoot,
      env,
      stdio: 'inherit'
    });
  }
}
