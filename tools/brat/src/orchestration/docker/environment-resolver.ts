import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

export interface EnvironmentVariables {
  [key: string]: string | number | boolean;
}

export class EnvironmentResolver {
  constructor(private readonly repoRoot: string) {}

  public resolve(envName: string = 'local', securePath?: string): EnvironmentVariables {
    const envDir = path.join(this.repoRoot, 'env', envName);

    const globalYaml = this.loadYamlIfExists(path.join(envDir, 'global.yaml'));
    const infraYaml = this.loadYamlIfExists(path.join(envDir, 'infra.yaml'));

    const serviceYaml: EnvironmentVariables = {};
    if (fs.existsSync(envDir)) {
      for (const file of fs.readdirSync(envDir)) {
        if (!file.endsWith('.yaml')) continue;
        if (file === 'global.yaml' || file === 'infra.yaml') continue;
        const y = this.loadYamlIfExists(path.join(envDir, file));
        Object.assign(serviceYaml, y);
      }
    }

    // Sprint 358: Use context-specific secure file if provided, otherwise default to .secure.local
    const secureFilePath = securePath
      ? path.join(this.repoRoot, securePath)
      : path.join(this.repoRoot, '.secure.local');
    const secureEnv = this.loadSecureLocal(secureFilePath);

    const merged: EnvironmentVariables = {
      ...globalYaml,
      ...infraYaml,
      ...serviceYaml,
      ...secureEnv,
    };

    // Ensure sensible defaults
    if (merged['SERVICE_PORT'] === undefined) {
      merged['SERVICE_PORT'] = 3000;
    }

    return merged;
  }

  private loadYamlIfExists(filePath: string): EnvironmentVariables {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return (yaml.load(content) as EnvironmentVariables) || {};
      }
    } catch (e: any) {
      console.error(`[EnvironmentResolver] Failed to load YAML ${filePath}:`, e.message);
    }
    return {};
  }

  private loadSecureLocal(filePath: string): EnvironmentVariables {
    const env: EnvironmentVariables = {};
    if (!fs.existsSync(filePath)) return env;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('export ')) line = line.slice(7).trim();

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      value = this.stripQuotes(value);
      value = this.expandTilde(value);

      if (key) {
        env[key] = value;
      }
    }
    return env;
  }

  private stripQuotes(val: string): string {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private expandTilde(val: string): string {
    if (val === '~') return os.homedir();
    if (val.startsWith('~/')) return path.join(os.homedir(), val.slice(2));
    return val;
  }

  public static flattenToDotEnv(obj: EnvironmentVariables): string {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      lines.push(`${k}=${String(v)}`);
    }
    lines.sort();
    return lines.join('\n') + '\n';
  }
}
