import * as path from 'path';

export interface PortAssignment {
  service: string;
  port: number;
  explicit: boolean;
}

export class PortManager {
  private readonly defaultStartPort = 3001;

  public resolvePorts(
    serviceFiles: string[],
    env: { [key: string]: any }
  ): PortAssignment[] {
    const assignments: PortAssignment[] = [];
    const usedPorts = new Set<number>();
    
    // First pass: identify explicit ports
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

    // Second pass: resolve implicit ports
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
