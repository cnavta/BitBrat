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

    // Sprint 374: Load environment variables from .secure.{ENV}/.env (inside secure directory)
    // This keeps all secrets in one place: both .env files and credential files
    // Backward compatibility: Also check for old .secure.{ENV} file format (Sprint 373 and earlier)
    let secureFilePath: string;
    if (securePath) {
      const providedPath = path.join(this.repoRoot, securePath);
      // Check if provided path is a directory (new format) or file (old format)
      if (fs.existsSync(providedPath)) {
        if (fs.statSync(providedPath).isDirectory()) {
          // New format: .secure.{ENV}/ directory with .env file inside
          secureFilePath = path.join(providedPath, '.env');
        } else {
          // Old format: .secure.{ENV} file
          secureFilePath = providedPath;
        }
      } else {
        // Doesn't exist - assume new format
        secureFilePath = path.join(providedPath, '.env');
      }
    } else {
      // Try new format first: .secure.{ENV}/.env (inside directory)
      const newFormatPath = path.join(this.repoRoot, `.secure.${envName}`, '.env');
      // Fallback to old format: .secure.{ENV} (file at root)
      const oldFormatPath = path.join(this.repoRoot, `.secure.${envName}`);

      if (fs.existsSync(newFormatPath)) {
        secureFilePath = newFormatPath;
      } else if (fs.existsSync(oldFormatPath) && fs.statSync(oldFormatPath).isFile()) {
        // Old format detected - use it for backward compatibility
        secureFilePath = oldFormatPath;
      } else {
        // Neither exists - use new format path (loadSecureLocal will return empty)
        secureFilePath = newFormatPath;
      }
    }
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

    // Sprint 374: Construct DATABASE_URL from individual components if not explicitly set
    // This prevents shell variable substitution issues in YAML files
    if (!merged['DATABASE_URL'] && merged['POSTGRES_HOST'] && merged['POSTGRES_DB']) {
      const user = merged['POSTGRES_USER'] || 'bitbrat';
      const password = merged['POSTGRES_PASSWORD'] || 'bitbrat_dev_password';
      const host = merged['POSTGRES_HOST'];
      const port = merged['POSTGRES_PORT'] || '5432';
      const db = merged['POSTGRES_DB'];
      merged['DATABASE_URL'] = `postgresql://${user}:${password}@${host}:${port}/${db}`;
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

    // Sprint 374: Skip if path is a directory (not a file)
    // This handles the case where old .secure.{ENV} directories exist
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return env;
    }

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
