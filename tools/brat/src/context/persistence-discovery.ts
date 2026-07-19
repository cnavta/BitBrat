/**
 * Sprint 349: Persistence Auto-Discovery
 *
 * Discovers PostgreSQL containers from Docker compose stack.
 * Supports both local (unix socket) and remote (SSH) Docker hosts.
 */

import { execSync } from 'child_process';
import type { ResolvedPersistence } from './types';

/**
 * Discover PostgreSQL container from Docker compose stack
 *
 * @param dockerHost - Docker host (unix:// or ssh://)
 * @returns Resolved persistence config, or null if not found
 */
export async function discoverPostgresContainer(dockerHost: string): Promise<ResolvedPersistence | null> {
  try {
    const isRemote = dockerHost.includes('ssh://');
    const inspectCmd = buildDockerInspectCommand(dockerHost, isRemote);

    const output = execSync(inspectCmd, {
      encoding: 'utf8',
      timeout: 10000, // 10 second timeout
      stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
    });

    return parsePostgresConfig(output);
  } catch (error) {
    // Failed to discover (docker not running, no postgres container, etc.)
    return null;
  }
}

/**
 * Build docker inspect command for postgres container
 */
function buildDockerInspectCommand(dockerHost: string, isRemote: boolean): string {
  // Look for container with label postgres or with image containing 'postgres'
  const findCmd = `docker ps --filter 'name=postgres' --format '{{.Names}}'`;
  const inspectCmd = `docker inspect $(${findCmd}) --format '{{json .Config.Env}}'`;

  if (isRemote) {
    const sshTarget = dockerHost.replace('ssh://', '');
    return `ssh ${sshTarget} "${inspectCmd}"`;
  }

  return inspectCmd;
}

/**
 * Parse postgres config from docker inspect output
 *
 * Docker inspect returns env vars as JSON array:
 * ["POSTGRES_USER=bitbrat","POSTGRES_PASSWORD=secret","POSTGRES_DB=bitbrat"]
 */
function parsePostgresConfig(output: string): ResolvedPersistence | null {
  if (!output || output.trim() === '') {
    return null;
  }

  try {
    const envVars = JSON.parse(output) as string[];
    const config: Record<string, string> = {};

    for (const envVar of envVars) {
      const eqIndex = envVar.indexOf('=');
      if (eqIndex === -1) continue;

      const key = envVar.substring(0, eqIndex).trim();
      const value = envVar.substring(eqIndex + 1);

      if (key.startsWith('POSTGRES_')) {
        config[key] = value;
      }
    }

    // Extract required fields
    const user = config['POSTGRES_USER'];
    const password = config['POSTGRES_PASSWORD'];
    const database = config['POSTGRES_DB'] || config['POSTGRES_USER']; // Default DB name = user

    if (!user || !password) {
      return null; // Missing required config
    }

    return {
      driver: 'postgres',
      connection: {
        host: 'postgres', // Docker compose service name
        port: 5432, // Default postgres port
        database: database || 'postgres',
        username: user,
        password: password,
      },
    };
  } catch (error) {
    // Failed to parse JSON
    return null;
  }
}
