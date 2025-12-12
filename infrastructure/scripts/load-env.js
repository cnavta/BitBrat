#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

function parseArgs(argv) {
  const args = { env: process.env.BITBRAT_ENV || 'prod', service: '', format: 'json', onlyKeys: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') { args.env = argv[++i] || args.env; }
    else if (a === '--service') { args.service = argv[++i] || ''; }
    else if (a === '--format') { args.format = argv[++i] || 'json'; }
    else if (a === '--only-keys') { const v = argv[++i] || ''; args.onlyKeys = v ? v.split(',').map(s => s.trim()).filter(Boolean) : []; }
    else if (a === '-h' || a === '--help') { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: load-env --env <name> [--service <service-name>] [--only-keys A,B] [--format json|env]\nMerges env/<name>/global.yaml with an optional service-specific YAML (env/<name>/<service>.yaml).\nWhen --service is omitted, all service YAMLs under env/<name> are merged (legacy behavior).\nOutputs JSON by default, or KEY=VAL lines when --format env.`);
}

function loadYamlIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) || {};
    }
  } catch (e) {
    console.error(`[load-env] Failed to load YAML ${filePath}:`, e.message);
  }
  return {};
}

function stripQuotes(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
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

function flattenToEnvLines(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}=${String(v)}`);
  }
  lines.sort();
  return lines.join('\n');
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }
  const repoRoot = path.resolve(__dirname, '../..');
  const envDir = path.join(repoRoot, 'env', args.env);

  const globalYaml = loadYamlIfExists(path.join(envDir, 'global.yaml'));
  let mergedServiceYaml = {};
  if (args.service) {
    // Only merge the YAML file that matches the service name (support a few common variants)
    const svc = String(args.service).trim();
    const candidates = [
      `${svc}.yaml`,
      `${svc.replace(/\s+/g, '-').toLowerCase()}.yaml`,
      `${svc.replace(/\s+/g, '-')}.yaml`,
    ];
    for (const fname of candidates) {
      const p = path.join(envDir, fname);
      if (fs.existsSync(p)) {
        mergedServiceYaml = loadYamlIfExists(p) || {};
        break;
      }
    }
  } else {
    // Legacy behavior: merge all service YAMLs under the env directory (excluding global/infra)
    if (fs.existsSync(envDir)) {
      for (const file of fs.readdirSync(envDir)) {
        if (!file.endsWith('.yaml')) continue;
        if (file === 'global.yaml' || file === 'infra.yaml') continue;
        const y = loadYamlIfExists(path.join(envDir, file));
        Object.assign(mergedServiceYaml, y || {});
      }
    }
  }

  // Per clarified scope, do not automatically merge developer-local overrides into deploy-time env when --service is provided.
  // Keep output strictly to global + service overlay content in that case.
  let merged = mergeEnv(globalYaml, mergedServiceYaml);
  if (!args.service) {
    const secureEnv = loadSecureLocal(path.join(repoRoot, '.secure.local'));
    merged = mergeEnv(merged, secureEnv);
  }

  if (Array.isArray(args.onlyKeys) && args.onlyKeys.length > 0) {
    merged = Object.fromEntries(Object.entries(merged).filter(([k]) => args.onlyKeys.includes(k)));
  }

  if (args.format === 'env') {
    process.stdout.write(flattenToEnvLines(merged));
    return;
  }
  if (args.format === 'kv') {
    const pairs = Object.entries(merged)
      .filter(([k, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort();
    process.stdout.write(pairs.join(';'));
    return;
  }
  process.stdout.write(JSON.stringify(merged));
})();
