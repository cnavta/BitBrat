const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

function loadYamlIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) || {};
    }
  } catch (e) {
    console.error(`[merge-env] Failed to load YAML ${filePath}:`, e.message);
  }
  return {};
}

function stripQuotes(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expandTilde(val) {
  if (typeof val !== 'string') return val;
  if (val === '~') return os.homedir();
  if (val.startsWith('~/')) return path.join(os.homedir(), val.slice(2));
  return val;
}

function loadSecureLocal(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (let raw of lines) {
    if (!raw) continue;
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = stripQuotes(value);
    value = expandTilde(value);
    if (key) env[key] = value;
  }
  return env;
}

function mergeEnv(...objs) {
  return objs.reduce((acc, obj) => ({ ...acc, ...obj }), {});
}

function flattenToDotEnv(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}=${String(v)}`);
  }
  lines.sort();
  return lines.join('\n') + '\n';
}

(function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const cwd = process.cwd();
  if (path.resolve(cwd) !== repoRoot) {
    console.warn(`[merge-env] Warning: expected to be run from repo root. cwd=${cwd}, repoRoot=${repoRoot}`);
  }
  const envName = process.env.BITBRAT_ENV || process.argv[2] || 'local';
  const envDir = path.join(repoRoot, 'env', envName);

  const globalYaml = loadYamlIfExists(path.join(envDir, 'global.yaml'));
  const infraYaml = loadYamlIfExists(path.join(envDir, 'infra.yaml'));
  // Merge all service YAMLs present in envDir except global/infra
  const serviceYaml = {};
  if (fs.existsSync(envDir)) {
    for (const file of fs.readdirSync(envDir)) {
      if (!file.endsWith('.yaml')) continue;
      if (file === 'global.yaml' || file === 'infra.yaml') continue;
      const y = loadYamlIfExists(path.join(envDir, file));
      Object.assign(serviceYaml, y || {});
    }
  }

  const secureEnv = loadSecureLocal(path.join(repoRoot, '.secure.local'));

  const merged = mergeEnv(globalYaml, infraYaml, serviceYaml, secureEnv);

  // Ensure sensible defaults if not provided
  if (!merged.SERVICE_PORT) merged.SERVICE_PORT = 3000;

  const outPath = path.join(repoRoot, '.env.local');
  fs.writeFileSync(outPath, flattenToDotEnv(merged), 'utf8');
  console.log(`[merge-env] Wrote ${outPath} for env=${envName}`);
})();
