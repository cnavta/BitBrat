import * as fs from 'fs';
import * as path from 'path';

export interface ComposeFileSet {
  baseFile: string;
  serviceFiles: string[];
}

export class ComposeFactory {
  private readonly baseComposePath = 'infrastructure/docker-compose/docker-compose.local.yaml';
  private readonly servicesDir = 'infrastructure/docker-compose/services';

  constructor(private readonly repoRoot: string) {}

  public getComposeFiles(targetService?: string): ComposeFileSet {
    const baseFile = path.join(this.repoRoot, this.baseComposePath);
    const serviceFiles: string[] = [];

    const fullServicesDir = path.join(this.repoRoot, this.servicesDir);

    if (targetService) {
      const kebabService = targetService.replace(/_/g, '-');
      const serviceFile = path.join(fullServicesDir, `${kebabService}.compose.yaml`);
      if (fs.existsSync(serviceFile)) {
        serviceFiles.push(serviceFile);
      } else {
        throw new Error(`Compose file not found for service: ${targetService} at ${serviceFile}`);
      }
    } else {
      if (fs.existsSync(fullServicesDir)) {
        const files = fs.readdirSync(fullServicesDir)
          .filter(f => f.endsWith('.compose.yaml'))
          .sort()
          .map(f => path.join(fullServicesDir, f));
        serviceFiles.push(...files);
      }
    }

    return { baseFile, serviceFiles };
  }

  public buildComposeArgs(fileSet: ComposeFileSet, envFiles: string[]): string[] {
    const args: string[] = [];
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
