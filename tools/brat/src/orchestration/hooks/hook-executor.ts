/**
 * Hook Executor - Deployment Lifecycle Hooks
 *
 * Executes shell scripts at critical deployment stages to enable:
 * - Private container registry authentication
 * - Pre-flight validation
 * - Post-deployment verification
 * - Custom deployment logic
 *
 * @module orchestration/hooks/hook-executor
 * @since Sprint 15
 */

import { execCmd } from '../exec';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Hook execution context.
 * Passed as environment variables to hook scripts.
 */
export interface HookContext {
  /** Execution context name (e.g., 'local', 'staging', 'prod') */
  contextName: string;

  /** Deployment type (e.g., 'docker-compose', 'cloud-run') */
  deploymentType: string;

  /** Deployment target host (e.g., 'ssh://root@bitbrat.lan') */
  targetHost?: string;

  /** Remote directory (for SSH deployments) */
  remoteDir?: string;

  /** Services being deployed (space-separated string in env var) */
  services: string[];

  /** Repository root directory */
  repoRoot: string;

  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Hook types supported by the deployment system.
 */
export type HookType = 'pre-deploy' | 'post-deploy' | 'pre-build' | 'post-build';

/**
 * Hook execution result.
 */
export interface HookResult {
  /** Hook executed successfully */
  success: boolean;

  /** Hook was skipped (not defined) */
  skipped: boolean;

  /** Execution duration in milliseconds */
  durationMs?: number;

  /** Hook exit code (0 = success) */
  exitCode?: number;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Executes deployment lifecycle hooks.
 *
 * Hooks are shell scripts that run at specific deployment stages:
 * - pre-deploy: Before sync (remote) or build (local) - for registry auth
 * - pre-build: After sync, before build - for build-time auth
 * - post-build: After build, before up - for image scanning
 * - post-deploy: After containers start - for health checks
 *
 * @example
 * ```typescript
 * const executor = new HookExecutor();
 *
 * await executor.execute(
 *   'pre-deploy',
 *   '.brat/hooks/staging/pre-deploy-gcp-auth.sh',
 *   {
 *     contextName: 'staging',
 *     deploymentType: 'docker-compose',
 *     targetHost: 'ssh://root@bitbrat.lan',
 *     remoteDir: '/opt/bitbrat-staging',
 *     services: ['obs-mcp'],
 *     repoRoot: '/Users/user/BitBratPlatform',
 *   }
 * );
 * ```
 */
export class HookExecutor {
  /**
   * Execute a deployment hook.
   *
   * @param hookType - Type of hook to execute
   * @param hookPath - Path to hook script (relative to repo root)
   * @param context - Hook execution context
   * @returns Hook execution result
   * @throws Error if hook fails (non-zero exit code)
   */
  async execute(
    hookType: HookType,
    hookPath: string | undefined,
    context: HookContext
  ): Promise<HookResult> {
    // If hook not defined, skip
    if (!hookPath) {
      if (context.verbose) {
        console.log(`[hooks] No ${hookType} hook defined, skipping`);
      }
      return { success: true, skipped: true };
    }

    const fullPath = path.join(context.repoRoot, hookPath);

    // Validate hook file exists
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `${hookType} hook not found: ${hookPath}\n` +
          `Expected path: ${fullPath}\n` +
          `Check deployment.hooks.${hookType} in architecture.yaml executionContexts.${context.contextName}`
      );
    }

    // Validate hook file is executable (Unix-like systems only)
    if (process.platform !== 'win32') {
      const stats = fs.statSync(fullPath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      if (!isExecutable) {
        throw new Error(
          `${hookType} hook is not executable: ${hookPath}\n` +
            `Run: chmod +x ${hookPath}`
        );
      }
    }

    console.log(`[hooks] Executing ${hookType} hook: ${hookPath}`);

    const startTime = Date.now();

    // Build environment variables for hook
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BRAT_CONTEXT_NAME: context.contextName,
      BRAT_DEPLOYMENT_TYPE: context.deploymentType,
      BRAT_SERVICES: context.services.join(' '),
      BRAT_REPO_ROOT: context.repoRoot,
    };

    if (context.targetHost) {
      env.BRAT_TARGET_HOST = context.targetHost;
    }

    if (context.remoteDir) {
      env.BRAT_REMOTE_DIR = context.remoteDir;
    }

    // Determine shell command based on file extension
    let cmd: string;
    let args: string[];

    if (hookPath.endsWith('.ts') || hookPath.endsWith('.js')) {
      // TypeScript/JavaScript hook - execute with Node.js
      // Sprint 15: Phase 1 implements shell hooks only
      // TypeScript/JavaScript support deferred to Phase 4
      throw new Error(
        `TypeScript/JavaScript hooks not yet supported: ${hookPath}\n` +
          `Use shell scripts (.sh, .bash) for now.\n` +
          `TypeScript hook support coming in Phase 4.`
      );
    } else {
      // Shell script - execute directly
      cmd = fullPath;
      args = [];
    }

    // Execute hook
    const result = await execCmd(cmd, args, {
      cwd: context.repoRoot,
      env,
      stdio: 'inherit', // Stream output to console
    });

    const durationMs = Date.now() - startTime;

    if (result.code !== 0) {
      throw new Error(
        `${hookType} hook failed with exit code ${result.code}\n` +
          `Hook: ${hookPath}\n` +
          `Duration: ${durationMs}ms\n` +
          `Fix the hook script and retry deployment.`
      );
    }

    console.log(`[hooks] ✓ ${hookType} hook succeeded (${durationMs}ms)`);

    return {
      success: true,
      skipped: false,
      durationMs,
      exitCode: result.code,
    };
  }

  /**
   * Execute a deployment hook on a remote host via SSH.
   *
   * For remote deployments, pre-build, post-build, and post-deploy hooks
   * must execute on the remote host (after file sync).
   *
   * @param hookType - Type of hook to execute
   * @param hookPath - Path to hook script (relative to remote repo root)
   * @param context - Hook execution context (with remoteHost and remoteDir)
   * @returns Hook execution result
   * @throws Error if hook fails or SSH connection fails
   */
  async executeRemote(
    hookType: HookType,
    hookPath: string | undefined,
    context: HookContext
  ): Promise<HookResult> {
    // If hook not defined, skip
    if (!hookPath) {
      if (context.verbose) {
        console.log(`[hooks] No ${hookType} hook defined, skipping remote execution`);
      }
      return { success: true, skipped: true };
    }

    // Validate remote context
    if (!context.targetHost || !context.remoteDir) {
      throw new Error(
        `Remote hook execution requires targetHost and remoteDir in context.\n` +
          `Hook: ${hookPath}\n` +
          `Context: ${context.contextName}`
      );
    }

    // Parse SSH host (ssh://user@host or ssh://user@host:port)
    const sshHost = context.targetHost.replace('ssh://', '');
    const remoteHookPath = path.join(context.remoteDir, hookPath);

    console.log(`[hooks] Executing ${hookType} hook on remote: ${sshHost}:${remoteHookPath}`);

    const startTime = Date.now();

    // Build environment variables for remote hook
    const envVars = [
      `BRAT_CONTEXT_NAME=${context.contextName}`,
      `BRAT_DEPLOYMENT_TYPE=${context.deploymentType}`,
      `BRAT_SERVICES="${context.services.join(' ')}"`,
      `BRAT_REPO_ROOT=${context.remoteDir}`,
      `BRAT_TARGET_HOST=${context.targetHost}`,
      `BRAT_REMOTE_DIR=${context.remoteDir}`,
    ].join(' ');

    // Build SSH command to execute hook remotely
    // Format: ssh user@host "cd /remote/dir && VARS bash /remote/dir/hook.sh"
    const sshCommand = `cd "${context.remoteDir}" && ${envVars} bash "${remoteHookPath}"`;

    // Execute remote hook via SSH
    const result = await execCmd('ssh', [sshHost, sshCommand], {
      cwd: context.repoRoot,
      stdio: 'inherit', // Stream output to console
    });

    const durationMs = Date.now() - startTime;

    if (result.code !== 0) {
      throw new Error(
        `${hookType} hook failed on remote with exit code ${result.code}\n` +
          `Remote host: ${sshHost}\n` +
          `Hook: ${remoteHookPath}\n` +
          `Duration: ${durationMs}ms\n` +
          `Check remote hook script and SSH connectivity.`
      );
    }

    console.log(`[hooks] ✓ ${hookType} hook succeeded on remote (${durationMs}ms)`);

    return {
      success: true,
      skipped: false,
      durationMs,
      exitCode: result.code,
    };
  }
}
