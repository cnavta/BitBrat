/**
 * Sprint 349: Gateway URL Auto-Discovery
 *
 * Discovers api-gateway port from Docker by parsing `docker ps` output.
 * Supports both local (unix socket) and remote (SSH) Docker hosts.
 */

import { execSync } from 'child_process';

/**
 * Discover api-gateway port from Docker
 *
 * @param dockerHost - Docker host (unix:// or ssh://)
 * @returns Port number as string, or null if not found
 */
export async function discoverGatewayPort(dockerHost: string): Promise<string | null> {
  try {
    const isRemote = dockerHost.includes('ssh://');
    const command = buildDockerPsCommand(dockerHost, isRemote);

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 10000, // 10 second timeout
      stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    });

    return parsePortFromDockerPs(output);
  } catch (error) {
    // Failed to discover (docker not running, SSH unreachable, etc.)
    // Return null to allow fallback to other resolution methods
    return null;
  }
}

/**
 * Build docker ps command for local or remote host
 */
function buildDockerPsCommand(dockerHost: string, isRemote: boolean): string {
  const dockerPsCmd = `docker ps --filter 'label=com.docker.compose.service=api-gateway' --format '{{.Ports}}'`;

  if (isRemote) {
    // Extract SSH target from dockerHost (ssh://user@host → user@host)
    const sshTarget = dockerHost.replace('ssh://', '');
    return `ssh ${sshTarget} "${dockerPsCmd}"`;
  }

  // Local Docker (unix socket)
  return dockerPsCmd;
}

/**
 * Parse port from docker ps output
 *
 * Docker ps --format '{{.Ports}}' returns formats like:
 * - 0.0.0.0:3004->3000/tcp
 * - 0.0.0.0:3004->3000/tcp, 0.0.0.0:3005->3001/tcp
 * - [::]:3004->3000/tcp
 *
 * We want to extract the host port (3004 in the example)
 */
function parsePortFromDockerPs(output: string): string | null {
  if (!output || output.trim() === '') {
    return null;
  }

  // Match pattern: 0.0.0.0:PORT->... or [::]:PORT->...
  // Regex: (0\.0\.0\.0|\[::\]):(\d+)->
  const portRegex = /(0\.0\.0\.0|\[::\]):(\d+)->/;
  const match = output.match(portRegex);

  if (match && match[2]) {
    return match[2]; // Return the captured port number
  }

  return null;
}

/**
 * Extract host from SSH URL
 * Examples:
 * - ssh://root@bitbrat.lan → bitbrat.lan
 * - ssh://user@example.com:2222 → example.com
 */
export function extractHostFromSSH(sshUrl: string): string {
  const match = sshUrl.match(/ssh:\/\/(?:[^@]+@)?([^/:]+)/);
  return match ? match[1] : 'localhost';
}
