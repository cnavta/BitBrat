import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ArchitectureSchema, Architecture, Service } from './schema';

export interface ResolvedServiceConfig {
  name: string;
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
  const parsed = ArchitectureSchema.parse(raw);
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
    const port = (svc.port ?? d.port ?? 3000) as number;
    const min = (svc.scaling?.min ?? d.scaling?.min ?? dRun.minInstances ?? 0) as number;
    const max = (svc.scaling?.max ?? d.scaling?.max ?? dRun.maxInstances ?? 1) as number;
    const cpu = (svc.cpu ?? dRun.cpu ?? '1') as string;
    const memory = (svc.memory ?? dRun.memory ?? '512Mi') as string;
    const allowUnauth = (svc.security?.allowUnauthenticated ?? d.security?.allowUnauthenticated ?? true) as boolean;
    const envKeys = Array.from(new Set([...(d.env || []), ...(svc.env || [])]));
    const secrets = Array.from(new Set([...(svc.secrets || [])]));
    out[name] = { name, region, port, minInstances: min, maxInstances: max, cpu, memory, allowUnauth, envKeys, secrets };
  }
  return out;
}

export function loadEnvKv(envName: string, serviceEnvKeys?: string[]): string {
  // Reuse existing Node loader script for parity in Phase 1
  const script = path.join(process.cwd(), 'infrastructure/scripts/load-env.js');
  const { spawnSync } = require('child_process');
  const args = ['--env', envName, '--format', 'kv'];
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
