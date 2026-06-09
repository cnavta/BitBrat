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
