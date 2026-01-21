import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ArchitectureSchema, Architecture, Service } from './schema';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

interface InterpolationContext {
  [key: string]: string | undefined;
}

function buildInterpolationContext(raw: any): InterpolationContext {
  const env = (process.env.BITBRAT_ENV || 'prod').trim();
  const projectId = process.env.PROJECT_ID || '';
  // Prefer deploymentDefaults.region if present; fallback to defaults.services.region; else env var; else us-central1
  const region =
    raw?.deploymentDefaults?.region || raw?.defaults?.services?.region || process.env.REGION || 'us-central1';
  const envPrefix = env === 'prod' ? '' : `${env}.`;
  const domainSuffix = process.env.DOMAIN_SUFFIX || 'bitbrat.ai';
  const domainPrefix = process.env.DOMAIN_PREFIX || '';
  return {
    ENV: env,
    PROJECT_ID: projectId,
    REGION: String(region),
    ENV_PREFIX: envPrefix,
    DOMAIN_SUFFIX: domainSuffix,
    DOMAIN_PREFIX: domainPrefix,
  };
}

function applyTransform(val: string, transform?: string): string {
  if (!transform) return val;
  const t = transform.toLowerCase();
  if (t === 'lower') return val.toLowerCase();
  if (t === 'upper') return val.toUpperCase();
  // Unknown transforms: return original without change
  return val;
}

const DOLLAR_PLACEHOLDER = '\u0000DOLLAR\u0000';

function interpolateString(input: string, ctx: InterpolationContext, used: Set<string>, unresolved: Set<string>): string {
  if (!input || typeof input !== 'string') return input;
  // Escape $$ -> placeholder to allow literal $
  let s = input.replace(/\$\$/g, DOLLAR_PLACEHOLDER);
  // Pattern: ${VAR} or ${VAR:-default} optionally with transform: ${VAR|upper} or ${VAR|lower}
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:\|([a-zA-Z]+))?(?::-(.*?))?\}/g;
  s = s.replace(re, (_m, varName: string, transform: string | undefined, defVal: string | undefined) => {
    const key = String(varName);
    if (Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== undefined) {
      used.add(key);
      return applyTransform(String(ctx[key]!), transform);
    }
    if (defVal !== undefined) {
      // default provided
      used.add(key);
      return applyTransform(String(defVal), transform);
    }
    // Unknown/unresolved var: leave token as-is for visibility
    unresolved.add(key);
    return `\${${key}}`;
  });
  // Restore placeholder to $
  s = s.replace(new RegExp(DOLLAR_PLACEHOLDER, 'g'), '$');
  return s;
}

function deepInterpolate(obj: Json, ctx: InterpolationContext, pathArr: (string | number)[], used: Set<string>, unresolved: Set<string>): Json {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    return interpolateString(obj, ctx, used, unresolved);
  }
  if (Array.isArray(obj)) {
    return obj.map((v, i) => deepInterpolate(v as Json, ctx, [...pathArr, i], used, unresolved)) as Json;
  }
  if (typeof obj === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(obj as any)) {
      out[k] = deepInterpolate(v as Json, ctx, [...pathArr, k], used, unresolved);
    }
    return out as Json;
  }
  return obj;
}

function isCriticalPath(pathArr: (string | number)[]): boolean {
  // critical: *.infrastructure.resources.*.routing.default_domain
  const str = pathArr.filter((p) => typeof p === 'string').join('.');
  return /(^|\.)infrastructure\.resources\.[^.]+\.routing\.default_domain$/.test(str);
}

export interface ResolvedServiceConfig {
  name: string;
  image?: string;
  region: string;
  port: number;
  minInstances: number;
  maxInstances: number;
  cpu: string;
  memory: string;
  allowUnauth: boolean;
  envKeys: string[];
  secrets: string[];
}

export interface ResolvedConfig {
  architecture: Architecture;
  services: Record<string, ResolvedServiceConfig>;
  maxConcurrency: number;
  regionDefault: string;
}

function readYaml(filePath: string): any {
  const src = fs.readFileSync(filePath, 'utf8');
  return yaml.load(src);
}

export function loadArchitecture(rootDir: string): Architecture {
  const archPath = path.join(rootDir, 'architecture.yaml');
  const raw = readYaml(archPath);
  const enableInterpolation = (process.env.BITBRAT_INTERPOLATION || '').toLowerCase() !== '0';
  let materialized = raw;
  if (enableInterpolation) {
    const ctx = buildInterpolationContext(raw);
    const used = new Set<string>();
    const unresolved = new Set<string>();
    materialized = deepInterpolate(raw as Json, ctx, ['root'], used, unresolved) as any;
    // Validate critical fields do not contain unresolved tokens
    // Best-effort scan: if unresolved exists and materialized critical field still has ${, raise error
    // Walk only the known critical path
    try {
      const resources = materialized?.infrastructure?.resources || {};
      for (const key of Object.keys(resources)) {
        const dd = resources[key]?.routing?.default_domain;
        if (typeof dd === 'string' && /\$\{/.test(dd)) {
          throw new Error(`Unresolved interpolation in routing.default_domain for resource '${key}': ${dd}`);
        }
      }
    } catch (e) {
      throw e;
    }
    // Emit a simple log for visibility (avoid bringing logger here)
    const msg = {
      component: 'brat',
      action: 'config.interpolate',
      vars_used: Array.from(used).sort(),
      unresolved: Array.from(unresolved).sort(),
      notice: 'Set BITBRAT_INTERPOLATION=0 to disable interpolation temporarily',
    };
    try {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(msg));
    } catch {}
  }
  const parsed = ArchitectureSchema.parse(materialized);
  return parsed;
}

export function listServices(arch: Architecture): string[] {
  return Object.keys(arch.services || {});
}

export function resolveServices(arch: Architecture): Record<string, ResolvedServiceConfig> {
  const d = arch.defaults?.services || {} as any;
  const dRun = arch.deploymentDefaults?.['cloud-run'] || {} as any;
  const regionDefault = arch.deploymentDefaults?.region || d.region || 'us-central1';

  const out: Record<string, ResolvedServiceConfig> = {};
  for (const [name, svc] of Object.entries<Service>(arch.services || {} as any)) {
    const region = svc.region || d.region || regionDefault;
    const image = svc.image || d.image;
    const port = (svc.port ?? d.port ?? 3000) as number;
    const min = (svc.scaling?.min ?? d.scaling?.min ?? dRun.minInstances ?? 0) as number;
    const max = (svc.scaling?.max ?? d.scaling?.max ?? dRun.maxInstances ?? 1) as number;
    const cpu = (svc.cpu ?? dRun.cpu ?? '1') as string;
    const memory = (svc.memory ?? dRun.memory ?? '512Mi') as string;
    const allowUnauth = (svc.security?.allowUnauthenticated ?? d.security?.allowUnauthenticated ?? true) as boolean;
    const envKeys = Array.from(new Set([...(d.env || []), ...(svc.env || [])]));
    const secrets = Array.from(new Set([...(svc.secrets || [])]));
    out[name] = { name, image, region, port, minInstances: min, maxInstances: max, cpu, memory, allowUnauth, envKeys, secrets };
  }
  return out;
}

export function loadEnvKv(envName: string, serviceName?: string, serviceEnvKeys?: string[]): string {
  // Reuse existing Node loader script for parity in Phase 1
  const script = path.join(process.cwd(), 'infrastructure/scripts/load-env.js');
  const { spawnSync } = require('child_process');
  const args = ['--env', envName, '--format', 'kv'];
  if (serviceName && String(serviceName).trim().length > 0) {
    args.push('--service', String(serviceName));
  }
  if (serviceEnvKeys && serviceEnvKeys.length) {
    args.push('--only-keys', serviceEnvKeys.join(','));
  }
  const res = spawnSync('node', [script, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  const out = res.stdout?.toString?.() || '';
  return out.trim();
}

export function filterEnvKvAgainstSecrets(envKv: string, secretMapping: string): string {
  if (!envKv || !secretMapping) return envKv || '';
  const secretKeys = secretMapping.split(';').map((s) => s.split('=')[0]).filter(Boolean);
  const pairs = envKv.split(';').filter(Boolean);
  const filtered: string[] = [];
  for (const p of pairs) {
    const k = p.split('=')[0];
    if (!secretKeys.includes(k)) filtered.push(p);
  }
  return filtered.join(';');
}

export function synthesizeSecretMapping(secretNames: string[]): string {
  const names = secretNames || [];
  return names.map((n) => `${n}=${n}:latest`).join(';');
}

export function resolveConfig(rootDir: string): ResolvedConfig {
  const arch = loadArchitecture(rootDir);
  const services = resolveServices(arch);
  const maxConcurrency = arch.deploymentDefaults?.maxConcurrentDeployments ?? 1;
  const regionDefault = arch.deploymentDefaults?.region || arch.defaults?.services?.region || 'us-central1';
  return { architecture: arch, services, maxConcurrency, regionDefault };
}
