import { execCmd } from '../exec';
import { EnvironmentResolver } from './environment-resolver';
import { ComposeFactory } from './compose-factory';
import { PortManager } from './port-manager';
import { loadArchitecture, resolveServices } from '../../config/loader';
import { ContextResolver } from '../../context/context-resolver';
import * as fs from 'fs';
import * as path from 'path';

// Location (relative to a remote target's `remoteDir`) where the GCP ADC service
// account key is placed on the remote host. The per-service compose files bind-mount
// `${GOOGLE_APPLICATION_CREDENTIALS}` into the container, so for remote targets that
// variable is rewritten to `<remoteDir>/<REMOTE_ADC_RELATIVE_PATH>` and the real key
// is copied there by `syncRemoteFiles`. Without this, the local-only key path does
// not exist on the remote filesystem and GCP auth fails.
const REMOTE_ADC_RELATIVE_PATH = 'secrets/google-app-creds.json';

export interface DockerOrchestratorOptions {
  repoRoot: string;
  target?: string;
  env?: string;
  context?: string; // Sprint 349: Execution context name
  service?: string;
  dryRun?: boolean;
  loki?: boolean; // Enable Loki + Promtail observability stack
  noDeps?: boolean; // Don't start linked services (docker compose up --no-deps)
  forceRecreate?: boolean; // Force recreate containers (docker compose up --force-recreate)
  noCache?: boolean; // Build without cache (docker compose build --no-cache)
}

export class DockerOrchestrator {
  private readonly envResolver: EnvironmentResolver;
  private readonly composeFactory: ComposeFactory;
  private readonly portManager: PortManager;

  constructor(private readonly options: DockerOrchestratorOptions) {
    this.envResolver = new EnvironmentResolver(options.repoRoot);

    // Sprint 358: Use context-specific docker-compose file if it exists
    let baseComposePath: string | undefined;
    if (options.context) {
      const contextComposePath = `infrastructure/docker-compose/docker-compose.${options.context}.yaml`;
      const fullPath = path.join(options.repoRoot, contextComposePath);
      if (fs.existsSync(fullPath)) {
        baseComposePath = contextComposePath;
      }
    }

    this.composeFactory = new ComposeFactory(options.repoRoot, baseComposePath);
    this.portManager = new PortManager();
  }

  public async up(): Promise<void> {
    const { arch, targetConfig, envName, contextName, securePath } = await this.prepare();
    const tempEnvPath = await this.writeEnvFile(envName, targetConfig, contextName, securePath);

    // Deploy must honor architecture.yaml `active`. Services marked active:false (or absent,
    // which defaults to DISABLED) are never built/started here: on `--all` they are silently
    // filtered out, and an explicitly named inactive service fails fast inside getComposeFiles.
    // This mirrors the Cloud Run deploy path (selectDeployableServices) so e.g. obs-mcp with
    // active:false is no longer deployed to local or remote docker targets.
    const inactiveServices = Object.values(resolveServices(arch))
      .filter((s) => !s.active)
      .map((s) => s.name);

    const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, inactiveServices, this.options.loki);

    // Sprint 349: Determine compose project name from context or env
    const composeProjectName = contextName ? `bitbrat-${contextName}` : await this.getComposeProjectName(envName);

    try {
      const composeArgs = this.composeFactory.buildComposeArgs(composeFileSet, [tempEnvPath], composeProjectName);
      const isRemote = targetConfig.host?.startsWith('ssh://');

      await this.ensureRemoteSynced(targetConfig);
      await this.ensureNetworkExists(targetConfig);

      let maxConcurrent = targetConfig.maxConcurrent || arch.deploymentDefaults?.maxConcurrentDeployments || 3;
      if (isRemote && !targetConfig.maxConcurrent) {
        maxConcurrent = 1; // Default to 1 for SSH if not specified, to avoid "only one connection allowed"
      }

      const services = composeFileSet.serviceFiles.map(f => path.basename(f, '.compose.yaml'));

      // Base-file services with their own `build:` (e.g. firebase-emulator) are NOT part of
      // the per-service compose set, so `docker compose build <service>` never builds them.
      // On remote targets we run `up --no-build`, so they must be built explicitly here;
      // otherwise the remote `up` fails with "No such image" (e.g. bitbratplatform-firebase-emulator).
      const baseBuildServices = this.composeFactory.getBuildableBaseServices();
      const buildServices = [...baseBuildServices, ...services.filter(s => !baseBuildServices.includes(s))];

      if (isRemote) {
        console.log(`[brat] Remote target detected. Building and deploying ${buildServices.length} services...`);

        // Build services sequentially or in small batches for SSH targets to avoid connection resets.
        // We use the target's maxConcurrent for batching.
        for (let i = 0; i < buildServices.length; i += maxConcurrent) {
          const batch = buildServices.slice(i, i + maxConcurrent);
          console.log(`[brat] Building batch: ${batch.join(', ')}`);
          const buildArgs = [...composeArgs, 'build'];
          if (this.options.noCache) {
            buildArgs.push('--no-cache');
          }
          buildArgs.push(...batch);
          await this.executeDockerCompose(targetConfig, buildArgs);
        }

        // If --force-recreate was specified, explicitly stop AND remove the services first to release ports
        // before attempting to recreate. This prevents "port already allocated" errors caused by Docker
        // daemon caching network state. Just 'stop' is not enough - we need 'rm' to fully release ports.
        if (this.options.forceRecreate && this.options.service) {
          console.log(`[brat] Stopping and removing ${services.join(', ')} before force-recreate...`);
          const stopArgs = [...composeArgs, 'stop'];
          stopArgs.push(...services);
          await this.executeDockerCompose(targetConfig, stopArgs);

          // Remove containers to release port bindings
          const rmArgs = [...composeArgs, 'rm', '-f'];
          rmArgs.push(...services);
          await this.executeDockerCompose(targetConfig, rmArgs);
        }

        // Up all services in one go. Since this runs remotely via SSH (in executeDockerCompose),
        // it doesn't hit local SSH connection limits, and respects COMPOSE_PARALLEL_LIMIT on the remote host.
        // If --service was specified, pass the service names to docker compose up to start only those services.
        // If --no-deps was specified, add --no-deps to skip starting dependencies (nats, firebase-emulator, etc.)
        // If --force-recreate was specified, force recreation even if config unchanged (fixes port allocation issues)
        const upArgs = [...composeArgs, 'up', '-d', '--no-build'];
        if (this.options.forceRecreate) {
          upArgs.push('--force-recreate');
        }
        if (this.options.noDeps) {
          upArgs.push('--no-deps');
        }
        if (this.options.service) {
          upArgs.push(...services);
        }
        await this.executeDockerCompose(targetConfig, upArgs);
      } else {
        // If --force-recreate was specified, explicitly stop AND remove the services first to release ports
        if (this.options.forceRecreate && this.options.service) {
          console.log(`[brat] Stopping and removing ${services.join(', ')} before force-recreate...`);
          const stopArgs = [...composeArgs, 'stop'];
          stopArgs.push(...services);
          await this.executeDockerCompose(targetConfig, stopArgs);

          // Remove containers to release port bindings
          const rmArgs = [...composeArgs, 'rm', '-f'];
          rmArgs.push(...services);
          await this.executeDockerCompose(targetConfig, rmArgs);
        }

        const upArgs = [...composeArgs, 'up', '-d', '--build'];
        if (this.options.noCache) {
          upArgs.push('--no-cache');
        }
        if (this.options.forceRecreate) {
          upArgs.push('--force-recreate');
        }
        if (this.options.noDeps) {
          upArgs.push('--no-deps');
        }
        if (this.options.service) {
          upArgs.push(...services);
        }
        await this.executeDockerCompose(targetConfig, upArgs);
      }
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  public async down(): Promise<void> {
    const { targetConfig, envName, contextName, securePath } = await this.prepare();
    const tempEnvPath = await this.writeEnvFile(envName, targetConfig, contextName, securePath);
    const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, undefined, this.options.loki);
    const composeProjectName = contextName ? `bitbrat-${contextName}` : await this.getComposeProjectName(envName);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs(composeFileSet, [tempEnvPath], composeProjectName);
      await this.ensureRemoteSynced(targetConfig);
      await this.executeDockerCompose(targetConfig, [...composeArgs, 'down']);
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  public async logs(follow: boolean = false): Promise<void> {
    const { targetConfig, envName, contextName, securePath } = await this.prepare();
    const tempEnvPath = await this.writeEnvFile(envName, targetConfig, contextName, securePath);
    const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, undefined, this.options.loki);
    const composeProjectName = contextName ? `bitbrat-${contextName}` : await this.getComposeProjectName(envName);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs(composeFileSet, [tempEnvPath], composeProjectName);
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
    const { targetConfig, envName, contextName, securePath } = await this.prepare();
    const tempEnvPath = await this.writeEnvFile(envName, targetConfig, contextName, securePath);
    const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, undefined, this.options.loki);
    const composeProjectName = contextName ? `bitbrat-${contextName}` : await this.getComposeProjectName(envName);
    try {
      const composeArgs = this.composeFactory.buildComposeArgs(composeFileSet, [tempEnvPath], composeProjectName);
      await this.ensureRemoteSynced(targetConfig);
      await this.executeDockerCompose(targetConfig, [...composeArgs, 'ps']);
    } finally {
      this.cleanupEnvFile(tempEnvPath);
    }
  }

  private async writeEnvFile(envName: string, targetConfig: any, contextName?: string, securePath?: string): Promise<string> {
    const env = this.envResolver.resolve(envName, securePath);
    const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, undefined, this.options.loki);
    const assignments = await this.portManager.resolvePorts(composeFileSet.serviceFiles, env, targetConfig);
    const portOverrides = this.portManager.getEnvOverrides(assignments);

    // Sprint 349: Use context-specific COMPOSE_PROJECT_NAME if execution context is provided
    const composeProjectName = contextName ? `bitbrat-${contextName}` : (env['COMPOSE_PROJECT_NAME'] as string || 'bitbratplatform');

    const mergedEnv: Record<string, string | number | boolean> = {
      ...env,
      ...portOverrides,
      COMPOSE_PROJECT_NAME: composeProjectName
    };

    // For remote (ssh://) targets the ADC key lives only on the local machine, so the
    // local absolute path in GOOGLE_APPLICATION_CREDENTIALS would not resolve as a bind
    // mount source on the remote daemon. Point it at the deterministic location where
    // syncRemoteFiles copies the real key on the remote host.
    const isRemote = targetConfig?.host?.startsWith('ssh://');
    if (isRemote && targetConfig?.remoteDir && mergedEnv['GOOGLE_APPLICATION_CREDENTIALS']) {
      mergedEnv['GOOGLE_APPLICATION_CREDENTIALS'] = path.posix.join(
        targetConfig.remoteDir,
        REMOTE_ADC_RELATIVE_PATH,
      );
    }

    const envContent = EnvironmentResolver.flattenToDotEnv(mergedEnv);
    const tempEnvPath = '.env.brat';
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);

    if (this.options.dryRun) {
      console.log(`[dry-run] Would write env file to ${fullEnvPath}`);
    } else {
      fs.writeFileSync(fullEnvPath, envContent);
      // Ensure subdirectories also have the env file for Docker Compose injection
      // This is because compose files at different depths expect .env.brat to be local to them.
      const subDirs = ['infrastructure/docker-compose', 'infrastructure/docker-compose/services'];
      for (const dir of subDirs) {
        const subDirPath = path.join(this.options.repoRoot, dir);
        if (fs.existsSync(subDirPath)) {
          fs.writeFileSync(path.join(subDirPath, tempEnvPath), envContent);
        }
      }
    }
    return tempEnvPath;
  }

  private cleanupEnvFile(tempEnvPath: string): void {
    const fullEnvPath = path.join(this.options.repoRoot, tempEnvPath);
    if (!this.options.dryRun && fs.existsSync(fullEnvPath)) {
      fs.unlinkSync(fullEnvPath);
      const subDirs = ['infrastructure/docker-compose', 'infrastructure/docker-compose/services'];
      for (const dir of subDirs) {
        const subEnvPath = path.join(this.options.repoRoot, dir, tempEnvPath);
        if (fs.existsSync(subEnvPath)) {
          fs.unlinkSync(subEnvPath);
        }
      }
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
    const mkdirResult = await execCmd('ssh', [sshTarget, `mkdir -p "${remoteDir}"`], { cwd: this.options.repoRoot });
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create remote directory ${remoteDir} on ${sshTarget}`);
    }

    // Sync essential files for Docker Compose
    // We sync infrastructure/docker-compose, .env.brat, and other config files
    // NOTE: firebase.json references firestore.rules and firestore.indexes.json
    // (see its `firestore` block). The firebase-emulator bootstrap copies both
    // firebase.json and firestore.rules from the mounted /workspace, so all three
    // must be synced to the remote; otherwise the emulator fails on startup with
    // `cp: cannot stat '/workspace/firestore.rules': No such file or directory`.
    const filesToSync = [
      'infrastructure/docker-compose',
      '.env.brat',
      'dummy-creds.json',
      'architecture.yaml',
      'firebase.json',
      'firestore.rules',
      'firestore.indexes.json'
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

    // Copy the real GCP ADC service account key to the remote host. The repo-relative
    // files synced above intentionally exclude it (the key lives at an absolute local
    // path outside the repo, e.g. from .secure.local), so it is handled separately.
    await this.syncAdcCredentials(target);

    // Verification check for critical files
    const criticalFiles = [
      path.join(remoteDir, '.env.brat'),
      path.join(remoteDir, 'infrastructure/docker-compose/.env.brat'),
      path.join(remoteDir, 'infrastructure/docker-compose/services/.env.brat')
    ];
    for (const file of criticalFiles) {
      const verifyResult = await execCmd('ssh', [sshTarget, `[ -f "${file}" ]`], { cwd: this.options.repoRoot });
      if (verifyResult.code !== 0) {
        // Only throw if it's the root .env.brat or if the corresponding directory exists
        if (file.endsWith('services/.env.brat')) {
           const dirExists = await execCmd('ssh', [sshTarget, `[ -d "${path.dirname(file)}" ]`], { cwd: this.options.repoRoot });
           if (dirExists.code !== 0) continue;
        }
        throw new Error(`Sync verification failed: ${file} not found on remote host ${sshTarget}`);
      }
    }
  }

  /**
   * Transfers the GCP Application Default Credentials (service account key) to the
   * remote host. The key path comes from the resolved environment
   * (GOOGLE_APPLICATION_CREDENTIALS, typically from .secure.local) and is copied to
   * `<remoteDir>/<REMOTE_ADC_RELATIVE_PATH>` — the same location writeEnvFile points
   * the container's GOOGLE_APPLICATION_CREDENTIALS at for remote targets.
   */
  private async syncAdcCredentials(target: any): Promise<void> {
    if (!target.remoteDir) return;

    const envName = this.options.env || target.env || 'local';
    const env = this.envResolver.resolve(envName);

    // Check if GCP services are actually being used
    const persistenceDriver = env['PERSISTENCE_DRIVER'] || 'postgres'; // Default is postgres (Sprint 344)
    const messageBusDriver = env['MESSAGE_BUS_DRIVER'] || 'nats';
    const needsGcp = persistenceDriver === 'firestore' || messageBusDriver === 'pubsub';

    if (!needsGcp) {
      console.log(
        `[brat] Skipping GCP credentials sync (PERSISTENCE_DRIVER=${persistenceDriver}, ` +
        `MESSAGE_BUS_DRIVER=${messageBusDriver} do not require GCP)`,
      );
      return;
    }

    const localKeyPath = env['GOOGLE_APPLICATION_CREDENTIALS'];

    if (!localKeyPath || typeof localKeyPath !== 'string') {
      console.warn(
        '[brat] GOOGLE_APPLICATION_CREDENTIALS is not set; skipping ADC key sync to remote host. ' +
          'Services that need GCP access will fail to authenticate.',
      );
      return;
    }

    if (!fs.existsSync(localKeyPath)) {
      console.warn(
        `[brat] GOOGLE_APPLICATION_CREDENTIALS is set to '${localKeyPath}' but file does not exist; ` +
        'skipping ADC key sync to remote host. Services that need GCP access will fail to authenticate.',
      );
      return;
    }

    const sshTarget = target.host.replace('ssh://', '');
    const remoteKeyPath = path.posix.join(target.remoteDir, REMOTE_ADC_RELATIVE_PATH);
    const remoteKeyDir = path.posix.dirname(remoteKeyPath);

    console.log(`[brat] Syncing GCP ADC key to remote: ${sshTarget}:${remoteKeyPath}`);

    const mkdirResult = await execCmd('ssh', [sshTarget, `mkdir -p "${remoteKeyDir}"`], {
      cwd: this.options.repoRoot,
    });
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create remote secrets directory ${remoteKeyDir} on ${sshTarget}`);
    }

    const scpResult = await execCmd('scp', [localKeyPath, `${sshTarget}:${remoteKeyPath}`], {
      cwd: this.options.repoRoot,
    });
    if (scpResult.code !== 0) {
      throw new Error(`Failed to copy ADC key to ${sshTarget}:${remoteKeyPath}`);
    }

    // Restrict permissions on the copied key (best-effort; do not fail the deploy on this).
    const chmodResult = await execCmd('ssh', [sshTarget, `chmod 600 "${remoteKeyPath}"`], {
      cwd: this.options.repoRoot,
    });
    if (chmodResult.code !== 0) {
      console.warn(`[brat] Could not chmod 600 the remote ADC key at ${remoteKeyPath}.`);
    }
  }

  private async ensureNetworkExists(target: any): Promise<void> {
    // Docker Compose automatically creates networks defined in the compose file.
    // We no longer pre-create networks here to avoid conflicts with compose-managed networks
    // that use the `name:` override (e.g., bitbrat-network -> bitbrat-staging-network).
    // This was causing duplicate networks on every deployment.
    if (this.options.dryRun) return;

    // No-op: Let docker-compose handle network creation
    return;
  }

  /**
   * Get compose project name from environment
   * Sprint 349: Reads COMPOSE_PROJECT_NAME from global.yaml
   */
  private async getComposeProjectName(envName: string): Promise<string> {
    const env = this.envResolver.resolve(envName);
    return (env['COMPOSE_PROJECT_NAME'] as string) || 'bitbratplatform';
  }

  private async prepare() {
    const arch = loadArchitecture(this.options.repoRoot);

    // Sprint 349: Support execution contexts
    if (this.options.context) {
      const resolver = new ContextResolver(this.options.repoRoot);
      const rawContext = await resolver.getRawContext(this.options.context);

      if (!rawContext) {
        throw new Error(`Context '${this.options.context}' not found`);
      }

      if (rawContext.deployment.type !== 'docker-compose') {
        throw new Error(`Context '${this.options.context}' uses deployment type '${rawContext.deployment.type}' which is not supported by 'brat docker'`);
      }

      // Create a synthetic target config from the execution context
      const targetConfig = {
        name: `context:${this.options.context}`,
        host: rawContext.deployment.docker?.host || 'unix:///var/run/docker.sock',
        remoteDir: rawContext.deployment.docker?.remoteDir,
        maxConcurrent: rawContext.deployment.docker?.maxConcurrent,
      };

      const envName = rawContext.runtime.envOverlay?.path?.replace('env/', '') || this.options.context;
      const securePath = rawContext.runtime.envOverlay?.secure; // Sprint 358: Context-specific secure file

      return { arch, targetConfig, envName, contextName: this.options.context, securePath };
    }

    // Legacy path: Use deploymentTargets from architecture.yaml
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

    // Extract project name from args (-p <name>) to set as environment variable
    // This allows ${COMPOSE_PROJECT_NAME} interpolation in compose files
    let projectName = 'bitbratplatform';
    const pIndex = args.indexOf('-p');
    if (pIndex !== -1 && pIndex + 1 < args.length) {
      projectName = args[pIndex + 1];
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      COMPOSE_PARALLEL_LIMIT: maxConcurrent.toString(),
      COMPOSE_PROJECT_NAME: projectName
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

    // If it's a remote target with a remoteDir, execute via SSH directly on the remote host.
    // This ensures that:
    // 1. Relative paths in compose files resolve correctly to the remote files.
    // 2. Bind mounts refer to paths on the remote host.
    // 3. Build contexts work correctly with relative paths (../.. etc)
    if (isSsh && target.remoteDir) {
      const sshTarget = target.host.replace('ssh://', '');
      const quotedArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ');

      // Try 'docker compose' first, then 'docker-compose'. Use /bin/sh -c for Alpine compatibility.
      // Don't use --project-directory for remote execution - it breaks build context path resolution
      // Set COMPOSE_PROJECT_NAME to enable ${COMPOSE_PROJECT_NAME} interpolation in compose files
      const remoteCmd = `sh -c 'cd "${target.remoteDir}" && (docker compose version >/dev/null 2>&1 && COMPOSE_PARALLEL_LIMIT=${maxConcurrent} COMPOSE_PROJECT_NAME=${projectName} docker compose ${quotedArgs} || COMPOSE_PARALLEL_LIMIT=${maxConcurrent} COMPOSE_PROJECT_NAME=${projectName} docker-compose ${quotedArgs})'`;
      
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
      env
    });

    if (result.code !== 0) {
      // Truncate output to last 5000 characters to avoid overwhelming error messages
      const truncatedStdout = result.stdout && result.stdout.length > 5000
        ? '...[truncated]...\n' + result.stdout.slice(-5000)
        : result.stdout;
      const truncatedStderr = result.stderr && result.stderr.length > 5000
        ? '...[truncated]...\n' + result.stderr.slice(-5000)
        : result.stderr;

      const errorMsg = [
        `Docker command failed with exit code ${result.code}`,
        `Command: ${cmd} ${finalArgs.join(' ')}`,
        truncatedStderr ? `Error: ${truncatedStderr}` : '',
        truncatedStdout ? `Output: ${truncatedStdout}` : ''
      ].filter(Boolean).join('\n');
      throw new Error(errorMsg);
    }
  }
}
