import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

export interface ComposeFileSet {
  baseFile: string;
  serviceFiles: string[];
}

export class ComposeFactory {
  private readonly baseComposePath = 'infrastructure/docker-compose/docker-compose.local.yaml';
  private readonly servicesDir = 'infrastructure/docker-compose/services';

  constructor(private readonly repoRoot: string) {}

  public getComposeFiles(targetService?: string): ComposeFileSet {
    const baseFile = this.baseComposePath;
    const serviceFiles: string[] = [];

    const fullServicesDir = path.join(this.repoRoot, this.servicesDir);

    if (targetService) {
      const kebabService = targetService.replace(/_/g, '-');
      const serviceFile = path.join(this.servicesDir, `${kebabService}.compose.yaml`);
      const fullServiceFile = path.join(this.repoRoot, serviceFile);
      if (fs.existsSync(fullServiceFile)) {
        serviceFiles.push(serviceFile);
      } else {
        throw new Error(`Compose file not found for service: ${targetService} at ${fullServiceFile}`);
      }
    } else {
      if (fs.existsSync(fullServicesDir)) {
        const files = fs.readdirSync(fullServicesDir)
          .filter(f => f.endsWith('.compose.yaml'))
          .sort()
          .map(f => path.join(this.servicesDir, f));
        serviceFiles.push(...files);
      }
    }

    return { baseFile, serviceFiles };
  }

  /**
   * Returns the names of services declared in the base compose file that have a
   * `build:` section (and therefore must be built locally), e.g. `firebase-emulator`.
   *
   * These services live in the base file rather than in `services/*.compose.yaml`,
   * so they are NOT part of the per-service build set derived from `getComposeFiles`.
   * On remote targets the orchestrator builds services explicitly and then runs
   * `up --no-build`; without this, base-file build services are never built and the
   * remote `up` fails with "No such image" (e.g. bitbratplatform-firebase-emulator).
   */
  public getBuildableBaseServices(): string[] {
    const fullBasePath = path.join(this.repoRoot, this.baseComposePath);
    if (!fs.existsSync(fullBasePath)) return [];

    let doc: any;
    try {
      doc = yaml.load(fs.readFileSync(fullBasePath, 'utf8'));
    } catch {
      return [];
    }

    const services = doc?.services;
    if (!services || typeof services !== 'object') return [];

    return Object.keys(services).filter((name) => {
      const svc = services[name];
      return svc && typeof svc === 'object' && svc.build != null;
    });
  }

  public buildComposeArgs(fileSet: ComposeFileSet, envFiles: string[]): string[] {
    const args: string[] = [];
    // Explicitly set project name to ensure consistency between build and up,
    // and between local and remote environments.
    args.push('-p', 'bitbratplatform');
    args.push('-f', fileSet.baseFile);
    for (const f of fileSet.serviceFiles) {
      args.push('-f', f);
    }
    for (const envFile of envFiles) {
      args.push('--env-file', envFile);
    }
    return args;
  }
}
