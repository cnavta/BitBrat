#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function parseArgs(argv) {
  const args = { service: '', format: 'json', listServices: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--service') { args.service = argv[++i] || ''; }
    else if (a === '--format') { args.format = argv[++i] || 'json'; }
    else if (a === '--list-services') { args.listServices = true; }
    else if (a === '-h' || a === '--help') { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: extract-config --service <name> [--format json|env]\n       extract-config --list-services\nReads architecture.yaml from repo root and emits merged config for a service.\nPrecedence: service overrides > defaults.services > deploymentDefaults (for cloud-run cpu/memory/region).\nOutputs keys: SERVICE_NAME, REGION, PORT, MIN_INSTANCES, MAX_INSTANCES, CPU, MEMORY, ALLOW_UNAUTH, SECRETS (array), SECRET_SET_ARG (comma list for --set-secrets).\nWhen --list-services is provided, prints service keys one per line.`);
}

function loadArch(rootDir) {
  const archPath = path.join(rootDir, 'architecture.yaml');
  const src = fs.readFileSync(archPath, 'utf8');
  return yaml.load(src);
}

function boolToStr(v) { return v ? 'true' : 'false'; }

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const arch = loadArch(root);
  if (args.help) { printHelp(); process.exit(0); }
  if (args.listServices) {
    const keys = Object.keys(arch.services || {});
    process.stdout.write(keys.join('\n'));
    return;
  }
  if (!args.service) { printHelp(); process.exit(2); }
  const svcName = args.service;
  const defaults = arch.defaults?.services || {};
  const dCloudRun = arch.deploymentDefaults?.['cloud-run'] || {};
  const svc = arch.services?.[svcName] || {};

  // Merge values
  const region = svc.region || defaults.region || arch.deploymentDefaults?.region || arch.defaults?.services?.region;
  const port = svc.port || defaults.port || 3000;
  const scaling = svc.scaling || defaults.scaling || { min: 0, max: 1 };
  const minInstances = (typeof scaling.min === 'number') ? scaling.min : (typeof dCloudRun.minInstances === 'number' ? dCloudRun.minInstances : 0);
  const maxInstances = (typeof scaling.max === 'number') ? scaling.max : (typeof dCloudRun.maxInstances === 'number' ? dCloudRun.maxInstances : 1);
  const cpu = svc.cpu || dCloudRun.cpu || '1';
  const memory = svc.memory || dCloudRun.memory || '512Mi';
  const allowUnauth = (svc.security && typeof svc.security.allowUnauthenticated === 'boolean')
    ? svc.security.allowUnauthenticated
    : (defaults.security && typeof defaults.security.allowUnauthenticated === 'boolean'
        ? defaults.security.allowUnauthenticated
        : true);

  const defEnvKeys = Array.isArray(defaults.env) ? defaults.env.map(String) : [];
  const svcEnvKeys = Array.isArray(svc.env) ? svc.env.map(String) : [];
  const envKeys = Array.from(new Set([...defEnvKeys, ...svcEnvKeys]));

  const secrets = Array.isArray(svc.secrets) ? svc.secrets.map(String) : [];
  const secretSetArg = secrets.map((s) => `${s}=${s}:latest`).join(';');

  const out = {
    SERVICE_NAME: svcName,
    REGION: region,
    PORT: Number(port),
    MIN_INSTANCES: Number(minInstances),
    MAX_INSTANCES: Number(maxInstances),
    CPU: String(cpu),
    MEMORY: String(memory),
    ALLOW_UNAUTH: allowUnauth === true,
    ENV_KEYS: envKeys,
    SECRETS: secrets,
    SECRET_SET_ARG: secretSetArg,
  };

  if (args.format === 'env') {
    const lines = [
      `SERVICE_NAME=${out.SERVICE_NAME}`,
      `REGION=${out.REGION}`,
      `PORT=${out.PORT}`,
      `MIN_INSTANCES=${out.MIN_INSTANCES}`,
      `MAX_INSTANCES=${out.MAX_INSTANCES}`,
      `CPU=${out.CPU}`,
      `MEMORY=${out.MEMORY}`,
      `ALLOW_UNAUTH=${boolToStr(out.ALLOW_UNAUTH)}`,
      `ENV_KEYS=${out.ENV_KEYS.join(',')}`,
      `SECRETS=${out.SECRETS.join(',')}`,
      `SECRET_SET_ARG=${out.SECRET_SET_ARG}`,
    ];
    process.stdout.write(lines.join('\n'));
    return;
  }
  process.stdout.write(JSON.stringify(out));
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('[extract-config] Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
