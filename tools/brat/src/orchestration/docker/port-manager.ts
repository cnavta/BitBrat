import * as path from 'path';
import { execCmd } from '../exec';

export interface PortAssignment {
  service: string;
  port: number;
  explicit: boolean;
}

export class PortManager {
  private readonly defaultStartPort = 3001;

  /**
   * Query the actual running containers on the target (local or remote) to discover
   * which ports are already allocated. This prevents port conflicts when deploying
   * a single service with --service --no-deps.
   *
   * @param targetConfig Target configuration (includes host for remote deployments)
   * @returns Set of ports currently in use by running containers
   */
  private async discoverUsedPorts(targetConfig: any): Promise<Set<number>> {
    const usedPorts = new Set<number>();

    try {
      // Get all running container port mappings
      // Format: "8080/tcp -> 0.0.0.0:8080" or "8080/tcp, 9090/tcp -> 0.0.0.0:9090"
      const isRemote = targetConfig?.host?.startsWith('ssh://');

      let result: { code: number; stdout: string; stderr: string };

      if (isRemote && targetConfig?.host && targetConfig?.remoteDir) {
        // Remote: ssh root@host "docker ps --format '{{.Ports}}'"
        const sshHost = targetConfig.host.replace('ssh://', '');
        result = await execCmd('ssh', [sshHost, 'docker ps --format "{{.Ports}}"']);
      } else {
        // Local: docker ps --format '{{.Ports}}'
        result = await execCmd('docker', ['ps', '--format', '{{.Ports}}']);
      }

      if (result.stdout) {
        // Parse port mappings like "0.0.0.0:3001->3000/tcp"
        const portRegex = /0\.0\.0\.0:(\d+)/g;
        let match;
        while ((match = portRegex.exec(result.stdout)) !== null) {
          usedPorts.add(parseInt(match[1], 10));
        }
      }
    } catch (error) {
      // If docker ps fails (daemon not running, SSH error, etc.), log and continue
      // with empty set. This gracefully degrades to the existing behavior.
      console.warn(`[brat] Failed to discover used ports: ${error}. Continuing without live port discovery.`);
    }

    return usedPorts;
  }

  public async resolvePorts(
    serviceFiles: string[],
    env: { [key: string]: any },
    targetConfig?: any
  ): Promise<PortAssignment[]> {
    const assignments: PortAssignment[] = [];

    // Discover ports already in use by running containers on the target
    // This ensures we don't conflict with services that aren't in our compose file list
    // (e.g., when using --service tool-gateway --no-deps, other services are still running)
    const usedPorts = targetConfig ? await this.discoverUsedPorts(targetConfig) : new Set<number>();

    // First pass: identify explicit ports from environment variables
    for (const file of serviceFiles) {
      const serviceName = path.basename(file).replace('.compose.yaml', '');
      const upperSvc = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const portVar = `${upperSvc}_HOST_PORT`;

      const hostPort = env[portVar];
      if (hostPort !== undefined) {
        const port = parseInt(String(hostPort), 10);
        assignments.push({ service: serviceName, port, explicit: true });
        usedPorts.add(port);
      } else {
        assignments.push({ service: serviceName, port: -1, explicit: false });
      }
    }

    // Second pass: resolve implicit ports by finding next available port
    // Now this considers BOTH explicitly assigned ports AND live container ports
    let nextFreePort = this.defaultStartPort;
    for (const assignment of assignments) {
      if (!assignment.explicit) {
        while (usedPorts.has(nextFreePort)) {
          nextFreePort++;
        }
        assignment.port = nextFreePort;
        usedPorts.add(nextFreePort);
        nextFreePort++;
      }
    }

    return assignments;
  }

  public getEnvOverrides(assignments: PortAssignment[]): { [key: string]: string } {
    const overrides: { [key: string]: string } = {};
    for (const assignment of assignments) {
      if (!assignment.explicit) {
        const upperSvc = assignment.service.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        overrides[`${upperSvc}_HOST_PORT`] = String(assignment.port);
      }
    }
    return overrides;
  }
}
