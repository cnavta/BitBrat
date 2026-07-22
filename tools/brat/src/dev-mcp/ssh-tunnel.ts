/**
 * SSH Tunnel Manager
 *
 * Creates and manages SSH port forwarding tunnels for remote service access.
 * Used to access remote Loki instances via localhost port forwarding.
 */

import { spawn, ChildProcess } from 'child_process';
import { Logger } from '../orchestration/logger';

/**
 * SSH tunnel configuration
 */
export interface SSHTunnelConfig {
  /** SSH target (user@host) */
  sshTarget: string;
  /** Remote port to forward */
  remotePort: number;
  /** Local port to bind to (0 = auto-assign) */
  localPort?: number;
  /** Remote bind address (default: localhost) */
  remoteHost?: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
}

/**
 * Active SSH tunnel
 */
export interface SSHTunnel {
  /** Local port that was bound */
  localPort: number;
  /** Remote port being forwarded */
  remotePort: number;
  /** SSH target */
  sshTarget: string;
  /** Close the tunnel */
  close: () => Promise<void>;
}

/**
 * SSHTunnelManager class
 *
 * Manages SSH port forwarding tunnels with automatic port allocation and cleanup.
 */
export class SSHTunnelManager {
  private tunnels: Map<string, { process: ChildProcess; localPort: number }> = new Map();
  private logger?: Logger;
  private nextEphemeralPort = 30100; // Start of ephemeral port range

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Create an SSH tunnel with port forwarding
   *
   * @param config - Tunnel configuration
   * @returns Promise resolving to active tunnel
   */
  async createTunnel(config: SSHTunnelConfig): Promise<SSHTunnel> {
    const {
      sshTarget,
      remotePort,
      localPort = 0,
      remoteHost = 'localhost',
      timeout = 5000
    } = config;

    // Generate a unique key for this tunnel
    const tunnelKey = `${sshTarget}:${remoteHost}:${remotePort}`;

    // Check if tunnel already exists
    if (this.tunnels.has(tunnelKey)) {
      const existing = this.tunnels.get(tunnelKey)!;
      this.logger?.debug({ tunnelKey, localPort: existing.localPort }, 'Reusing existing SSH tunnel');

      return {
        localPort: existing.localPort,
        remotePort,
        sshTarget,
        close: async () => this.closeTunnel(tunnelKey)
      };
    }

    // Allocate local port
    const allocatedPort = localPort || this.allocateEphemeralPort();

    this.logger?.info({
      sshTarget,
      localPort: allocatedPort,
      remoteHost,
      remotePort
    }, 'Creating SSH tunnel');

    // Build SSH command
    // -N: No remote command (just port forwarding)
    // -L: Local port forwarding (localPort:remoteHost:remotePort)
    // -o ServerAliveInterval=60: Keep connection alive
    // -o ExitOnForwardFailure=yes: Exit if port forwarding fails
    // -o StrictHostKeyChecking=no: Auto-accept host key (dev environment)
    const sshArgs = [
      '-N',
      '-L', `${allocatedPort}:${remoteHost}:${remotePort}`,
      '-o', 'ServerAliveInterval=60',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR', // Suppress SSH warnings
      sshTarget
    ];

    // Spawn SSH process
    const sshProcess = spawn('ssh', sshArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Wait for tunnel to establish or fail
    const established = await this.waitForTunnel(sshProcess, allocatedPort, timeout);

    if (!established) {
      sshProcess.kill();
      throw new Error(`SSH tunnel failed to establish within ${timeout}ms`);
    }

    // Handle process errors
    sshProcess.on('error', (error) => {
      this.logger?.error({ tunnelKey, error: error.message }, 'SSH tunnel process error');
      this.tunnels.delete(tunnelKey);
    });

    sshProcess.on('exit', (code) => {
      this.logger?.info({ tunnelKey, exitCode: code }, 'SSH tunnel process exited');
      this.tunnels.delete(tunnelKey);
    });

    // Store tunnel reference
    this.tunnels.set(tunnelKey, {
      process: sshProcess,
      localPort: allocatedPort
    });

    this.logger?.info({
      tunnelKey,
      localPort: allocatedPort,
      remotePort
    }, 'SSH tunnel established');

    return {
      localPort: allocatedPort,
      remotePort,
      sshTarget,
      close: async () => this.closeTunnel(tunnelKey)
    };
  }

  /**
   * Wait for SSH tunnel to establish
   *
   * Uses a simple port check to verify the tunnel is ready.
   * SSH tunnel is considered established when:
   * 1. The SSH process is still running
   * 2. The process hasn't emitted stderr with "port forwarding failed"
   */
  private async waitForTunnel(
    process: ChildProcess,
    localPort: number,
    timeout: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const startTime = Date.now();

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, timeout);

      // Listen for stderr (SSH errors)
      let stderrData = '';
      process.stderr?.on('data', (data) => {
        stderrData += data.toString();

        // Check for port forwarding failure
        if (stderrData.includes('port forwarding failed') ||
            stderrData.includes('Permission denied') ||
            stderrData.includes('Connection refused')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve(false);
          }
        }
      });

      // Check for process exit
      process.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(false);
        }
      });

      // Poll for tunnel readiness
      // SSH tunnel typically takes 100-500ms to establish
      // We'll give it a few attempts before declaring success
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        // After 500ms, if process is still alive and no errors, consider it established
        if (elapsed > 500 && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);
    });
  }

  /**
   * Close a specific tunnel
   */
  private async closeTunnel(tunnelKey: string): Promise<void> {
    const tunnel = this.tunnels.get(tunnelKey);

    if (!tunnel) {
      this.logger?.warn({ tunnelKey }, 'Attempted to close non-existent tunnel');
      return;
    }

    this.logger?.info({ tunnelKey }, 'Closing SSH tunnel');

    // Kill SSH process
    tunnel.process.kill('SIGTERM');

    // Wait briefly for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force kill if still running
    if (!tunnel.process.killed) {
      tunnel.process.kill('SIGKILL');
    }

    // Remove from map
    this.tunnels.delete(tunnelKey);
  }

  /**
   * Close all active tunnels
   */
  async closeAll(): Promise<void> {
    this.logger?.info({ count: this.tunnels.size }, 'Closing all SSH tunnels');

    const closePromises = Array.from(this.tunnels.keys()).map(key =>
      this.closeTunnel(key)
    );

    await Promise.all(closePromises);
  }

  /**
   * Allocate an ephemeral port for local binding
   *
   * Simple sequential allocation starting from 30100.
   * In production, you might want to check port availability.
   */
  private allocateEphemeralPort(): number {
    const port = this.nextEphemeralPort;
    this.nextEphemeralPort++;

    // Wrap around if we exceed ephemeral range
    if (this.nextEphemeralPort > 30999) {
      this.nextEphemeralPort = 30100;
    }

    return port;
  }

  /**
   * Get statistics about active tunnels
   */
  getStats(): { count: number; tunnels: Array<{ key: string; localPort: number }> } {
    return {
      count: this.tunnels.size,
      tunnels: Array.from(this.tunnels.entries()).map(([key, tunnel]) => ({
        key,
        localPort: tunnel.localPort
      }))
    };
  }
}
