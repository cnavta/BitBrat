import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentConfig } from '../plugins/base-plugin';

/**
 * Launch a coding agent with the provided configuration.
 *
 * Handles:
 * - Writing temporary config files
 * - Spawning child process with correct command, args, env
 * - Attaching stdin/stdout/stderr to parent process
 * - Lifecycle management (SIGTERM, SIGINT, cleanup)
 * - Cleanup of temporary files on exit
 *
 * @param config - Agent configuration (from plugin.prepareConfig)
 * @param additionalArgs - Additional CLI arguments to pass through
 * @returns Promise resolving to spawned child process
 * @throws Error if launch fails
 */
export async function launchAgent(
  config: AgentConfig,
  additionalArgs: string[] = []
): Promise<ChildProcess> {
  // Write temporary config files
  const tempFiles: string[] = [];
  if (config.configFiles) {
    for (const configFile of config.configFiles) {
      const filePath = path.isAbsolute(configFile.path)
        ? configFile.path
        : path.join(config.cwd || process.cwd(), configFile.path);

      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write config file
      await fs.writeFile(filePath, configFile.content, 'utf-8');

      if (configFile.temporary) {
        tempFiles.push(filePath);
      }
    }
  }

  // Merge environment variables
  const env = {
    ...process.env,
    ...config.env,
  };

  // Spawn child process
  const child = spawn(config.command, [...config.args, ...additionalArgs], {
    cwd: config.cwd || process.cwd(),
    env,
    stdio: 'inherit', // Attach stdin/stdout/stderr to parent
  });

  // Setup cleanup handlers
  setupCleanupHandlers(child, tempFiles);

  // Log launch details
  console.log(`Launched ${config.command} (PID: ${child.pid})`);

  return child;
}

/**
 * Setup cleanup handlers for agent process.
 *
 * Ensures temporary files are cleaned up on exit and handles
 * graceful shutdown on SIGTERM/SIGINT.
 *
 * @param child - Spawned child process
 * @param tempFiles - List of temporary file paths to clean up
 */
function setupCleanupHandlers(child: ChildProcess, tempFiles: string[]): void {
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    // Clean up temporary files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch (err) {
        // Ignore errors (file may not exist)
        console.debug(`Failed to clean up ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // Clean up on child exit
  child.on('exit', (code, signal) => {
    cleanup().catch((err) => {
      console.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    if (code !== null) {
      console.log(`Agent exited with code ${code}`);
    } else if (signal !== null) {
      console.log(`Agent killed by signal ${signal}`);
    }
  });

  // Clean up on parent exit
  const handleShutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down agent...`);

    // Forward signal to child
    if (child.pid && !child.killed) {
      child.kill(signal as NodeJS.Signals);
    }

    // Wait for child to exit
    child.on('exit', () => {
      process.exit(0);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      console.error('Agent did not exit gracefully, forcing shutdown');
      if (child.pid && !child.killed) {
        child.kill('SIGKILL');
      }
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  // Clean up on error
  child.on('error', (err) => {
    console.error(`Agent process error: ${err.message}`);
    cleanup().catch(() => {});
  });
}

/**
 * Wait for agent process to exit.
 *
 * Returns a promise that resolves when the agent exits, with the exit code.
 *
 * @param child - Child process to wait for
 * @returns Promise resolving to exit code (or null if killed by signal)
 */
export function waitForAgentExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });
}

/**
 * Check if a command exists in PATH.
 *
 * Useful for validating agent binaries before attempting to launch.
 *
 * @param command - Command name to check
 * @returns Promise resolving to true if command exists
 */
export async function commandExists(command: string): Promise<boolean> {
  const { spawn } = await import('child_process');
  const { promisify } = await import('util');
  const exec = promisify((await import('child_process')).exec);

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where' : 'which';

  try {
    await exec(`${cmd} ${command}`);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get version string from a command.
 *
 * Executes `command --version` and returns the output.
 * Useful for detecting installed agent versions.
 *
 * @param command - Command to get version for
 * @returns Promise resolving to version output or null if command fails
 */
export async function getCommandVersion(command: string): Promise<string | null> {
  const { promisify } = await import('util');
  const exec = promisify((await import('child_process')).exec);

  try {
    const { stdout, stderr } = await exec(`${command} --version`);
    return (stdout || stderr).trim();
  } catch (err) {
    return null;
  }
}

/**
 * Kill an agent process gracefully.
 *
 * Sends SIGTERM, waits for graceful shutdown, then SIGKILL if needed.
 *
 * @param child - Child process to kill
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving when process has exited
 */
export async function killAgent(child: ChildProcess, timeout: number = 5000): Promise<void> {
  if (!child.pid || child.killed) {
    return; // Already dead
  }

  return new Promise((resolve, reject) => {
    let killed = false;

    // Send SIGTERM
    child.kill('SIGTERM');

    // Wait for exit
    child.on('exit', () => {
      killed = true;
      resolve();
    });

    // Timeout handler
    const killTimeout = setTimeout(() => {
      if (!killed) {
        console.warn('Agent did not exit gracefully, sending SIGKILL');
        child.kill('SIGKILL');

        // Give SIGKILL a bit more time
        setTimeout(() => {
          if (!killed) {
            reject(new Error('Failed to kill agent process'));
          }
        }, 1000);
      }
    }, timeout);

    // Clear timeout on exit
    child.on('exit', () => {
      clearTimeout(killTimeout);
    });
  });
}
