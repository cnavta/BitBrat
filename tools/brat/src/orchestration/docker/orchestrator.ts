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

      await this.ensureRemoteSynced(targetConfig);

      let maxConcurrent = targetConfig.maxConcurrent || arch.deploymentDefaults?.maxConcurrentDeployments || 3;
      if (isRemote && !targetConfig.maxConcurrent) {
        maxConcurrent = 1; // Default to 1 for SSH if not specified, to avoid "only one connection allowed"
      }
      
      const services = serviceFiles.map(f => path.basename(f, '.compose.yaml'));

      if (isRemote) {
        console.log(`[brat] Remote target detected. Building and deploying ${services.length} services...`);
        
        // Build services sequentially or in small batches for SSH targets to avoid connection resets.
        // We use the target's maxConcurrent for batching.
        for (let i = 0; i < services.length; i += maxConcurrent) {
          const batch = services.slice(i, i + maxConcurrent);
          console.log(`[brat] Building batch: ${batch.join(', ')}`);
          await this.executeDockerCompose(targetConfig, [...composeArgs, 'build', ...batch]);
        }
        
        // Up all services in one go. Since this runs remotely via SSH (in executeDockerCompose),
        // it doesn't hit local SSH connection limits, and respects COMPOSE_PARALLEL_LIMIT on the remote host.
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
      await this.ensureRemoteSynced(targetConfig);
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
      await this.ensureRemoteSynced(targetConfig);
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
      await this.ensureRemoteSynced(targetConfig);
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
    const mkdirResult = await execCmd('ssh', [sshTarget, `mkdir -p ${remoteDir}`], { cwd: this.options.repoRoot });
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create remote directory ${remoteDir} on ${sshTarget}`);
    }

    // Sync essential files for Docker Compose
    // We sync infrastructure/docker-compose, .env.brat, and other config files
    const filesToSync = [
      'infrastructure/docker-compose',
      '.env.brat',
      'dummy-creds.json',
      'architecture.yaml',
      'firebase.json'
    ].filter(file => fs.existsSync(path.join(this.options.repoRoot, file)));

    if (filesToSync.length === 0) return;

    // Try rsync first as it is much more efficient for directories
    const rsyncResult = await execCmd('rsync', ['-azR', ...filesToSync, `${sshTarget}:${remoteDir}`], { 
      cwd: this.options.repoRoot 
    });

    if (rsyncResult.code !== 0) {
      console.warn(`[brat] rsync failed (code ${rsyncResult.code}), falling back to scp...`);
      
      for (const file of filesToSync) {
        const localPath = path.join(this.options.repoRoot, file);
        const remotePath = path.join(remoteDir, file);
        const remoteParent = path.dirname(remotePath);

        // Ensure parent directory exists on remote
        await execCmd('ssh', [sshTarget, `mkdir -p ${remoteParent}`]);

        if (fs.statSync(localPath).isDirectory()) {
          // For directories, sync content. scp -r localDir remoteParent/ puts localDir inside remoteParent/
          await execCmd('scp', ['-r', localPath, `${sshTarget}:${remoteParent}/`]);
        } else {
          // For files
          await execCmd('scp', [localPath, `${sshTarget}:${remotePath}`]);
        }
      }
    }

    // Verification check for critical file
    const verifyResult = await execCmd('ssh', [sshTarget, `[ -f ${remoteDir}/.env.brat ]`], { cwd: this.options.repoRoot });
    if (verifyResult.code !== 0) {
      throw new Error(`Sync verification failed: .env.brat not found at ${remoteDir}/.env.brat on remote host ${sshTarget}`);
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
      // Ensure DOCKER_HOST is not set when using context, as they conflict
      delete env['DOCKER_HOST'];
      // Also set DOCKER_CONTEXT env var for broader compatibility
      env['DOCKER_CONTEXT'] = target.context;
    } else if (target.host) {
      env['DOCKER_HOST'] = target.host;
    }

    const isSsh = target.host?.startsWith('ssh://');
    const isBuild = args.includes('build');

    // If it's a remote target with a remoteDir, and NOT a build command,
    // we execute via SSH directly on the remote host. This ensures that:
    // 1. Relative paths in compose files resolve correctly to the remote files.
    // 2. Bind mounts refer to paths on the remote host.
    if (isSsh && target.remoteDir && !isBuild) {
      const sshTarget = target.host.replace('ssh://', '');
      const quotedArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ');
      
      // Try 'docker compose' first, then 'docker-compose'. Use /bin/sh -c for Alpine compatibility.
      const remoteCmd = `sh -c 'cd ${target.remoteDir} && (docker compose version >/dev/null 2>&1 && COMPOSE_PARALLEL_LIMIT=${maxConcurrent} docker compose ${quotedArgs} || COMPOSE_PARALLEL_LIMIT=${maxConcurrent} docker-compose ${quotedArgs})'`;
      
      if (this.options.dryRun || process.env.DEBUG === 'brat:*') {
        console.log(`[brat:docker] Executing remotely: ssh ${sshTarget} "${remoteCmd}"`);
      }

      if (this.options.dryRun) return;

      const result = await execCmd('ssh', [sshTarget, remoteCmd], { 
        cwd: this.options.repoRoot,
        stdio: 'inherit'
      });
      if (result.code !== 0) {
        throw new Error(`Remote Docker command failed with exit code ${result.code}`);
      }
      return;
    }

    // Default to local execution (always for 'build', or for local targets)
    // Use '.' as project directory to ensure all relative paths (like build contexts)
    // resolve correctly from the repo root, especially when talking to a remote daemon.
    const finalArgs = [...globalArgs, 'compose', '--project-directory', '.', ...args];

    if (this.options.dryRun || process.env.DEBUG === 'brat:*') {
      console.log(`[brat:docker] Executing: ${env['DOCKER_HOST'] ? `DOCKER_HOST=${env['DOCKER_HOST']} ` : ''}${cmd} ${finalArgs.join(' ')}`);
    }

    if (this.options.dryRun) {
      return;
    }

    const result = await execCmd(cmd, finalArgs, { 
      cwd: this.options.repoRoot,
      env,
      stdio: 'inherit'
    });

    if (result.code !== 0) {
      throw new Error(`Docker command failed with exit code ${result.code}`);
    }
  }
}
