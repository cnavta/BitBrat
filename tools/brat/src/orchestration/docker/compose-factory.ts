import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

export interface ComposeFileSet {
  baseFile: string;
  serviceFiles: string[];
  observabilityFile?: string; // Optional Loki + Promtail stack
}

export class ComposeFactory {
  private readonly baseComposePath: string;
  private readonly servicesDir = 'infrastructure/docker-compose/services';
  private readonly observabilityPath = 'infrastructure/docker-compose/observability/docker-compose.observability.yaml';

  constructor(
    private readonly repoRoot: string,
    baseComposePath?: string
  ) {
    this.baseComposePath = baseComposePath || 'infrastructure/docker-compose/docker-compose.local.yaml';
  }

  /**
   * Resolve the compose file set for a deploy/run operation.
   *
   * `inactiveServices` is the canonical list of services marked `active:false` in
   * architecture.yaml (absent/false `active` => DISABLED; see defaults.services.active).
   * When provided, those services are NEVER included:
   *   - `--all` (no target): inactive per-service compose files are silently filtered out
   *     (parity with the Cloud Run deploy path / selectDeployableServices).
   *   - explicit target: an inactive named service fails fast rather than being deployed.
   *
   * Callers that must still address an inactive service (e.g. `down`/`logs`/`ps` to tear
   * down or inspect a previously-deployed disabled Bit) simply omit `inactiveServices`.
   *
   * `enableLoki` adds the optional observability stack (Loki + Promtail) for centralized logging.
   */
  public getComposeFiles(targetService?: string, inactiveServices?: Iterable<string>, enableLoki?: boolean): ComposeFileSet {
    const baseFile = this.baseComposePath;
    const serviceFiles: string[] = [];

    // Sprint 358: If using a context-specific compose file (not docker-compose.local.yaml),
    // skip service files since the context compose file already has all services defined
    const isContextSpecificCompose = !this.baseComposePath.endsWith('docker-compose.local.yaml');
    if (isContextSpecificCompose) {
      return { baseFile, serviceFiles: [], observabilityFile: undefined };
    }

    const fullServicesDir = path.join(this.repoRoot, this.servicesDir);

    // Compose file base names are kebab-case; normalize architecture service names to match.
    const inactive = new Set<string>();
    for (const name of inactiveServices ?? []) {
      inactive.add(name.replace(/_/g, '-'));
    }

    if (targetService) {
      const kebabService = targetService.replace(/_/g, '-');
      if (inactive.has(kebabService)) {
        throw new Error(
          `Service '${targetService}' is inactive (active:false) in architecture.yaml and cannot be deployed. ` +
          `Set active:true to deploy it.`
        );
      }
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
          .filter(f => !inactive.has(f.replace(/\.compose\.yaml$/, '')))
          .sort()
          .map(f => path.join(this.servicesDir, f));
        serviceFiles.push(...files);
      }
    }

    // Add observability file if Loki is enabled
    let observabilityFile: string | undefined;
    if (enableLoki) {
      const fullObservabilityPath = path.join(this.repoRoot, this.observabilityPath);
      if (fs.existsSync(fullObservabilityPath)) {
        observabilityFile = this.observabilityPath;
      }
    }

    return { baseFile, serviceFiles, observabilityFile };
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

  public buildComposeArgs(fileSet: ComposeFileSet, envFiles: string[], projectName: string = 'bitbratplatform'): string[] {
    const args: string[] = [];
    // Explicitly set project name to ensure consistency between build and up,
    // and between local and remote environments.
    // Sprint 349: Project name is now configurable via COMPOSE_PROJECT_NAME
    args.push('-p', projectName);
    args.push('-f', fileSet.baseFile);
    for (const f of fileSet.serviceFiles) {
      args.push('-f', f);
    }
    // Add observability file if present
    if (fileSet.observabilityFile) {
      args.push('-f', fileSet.observabilityFile);
    }
    for (const envFile of envFiles) {
      args.push('--env-file', envFile);
    }
    return args;
  }
}
