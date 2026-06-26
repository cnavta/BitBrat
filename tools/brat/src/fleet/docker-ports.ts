import { execSync } from 'child_process';
import type { Logger } from '../orchestration/logger';

/**
 * BL-204 follow-up — Local Docker host-port resolution for the fleet client.
 *
 * In a local Docker stack every Bit (and the tool-gateway) listens on the *internal* container port
 * (3000/8080) and self-publishes an internal URL — `http://<service>.bitbrat.local:<containerPort>/sse`
 * — to the `mcp_servers` registry. That host/port is only reachable from *inside* the compose
 * network; from the operator's machine the service is reachable only on its *published* host port
 * (`<SERVICE>_HOST_PORT`, e.g. `localhost:3001`). `deploy-local.sh` auto-assigns these to avoid
 * collisions, so they are NOT a fixed value.
 *
 * This module resolves a service's published host port the same way `brat chat` already does
 * (`<SERVICE>_HOST_PORT` env first, then a `docker ps` port-mapping probe), so fleet commands target
 * the correct mapped port per Bit instead of the hardcoded `3000`.
 */

/** Map a service name (e.g. `tool-gateway`) to its `<SERVICE>_HOST_PORT` env var name. */
export function hostPortEnvVar(service: string): string {
  return `${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HOST_PORT`;
}

/** Parse `docker ps`-style port mappings (e.g. `0.0.0.0:3006->3000/tcp, [::]:3006->3000/tcp`). */
export function parseDockerPortMapping(ports: string, containerPort?: number): number | undefined {
  const re = /:(\d+)->(\d+)\/tcp/g;
  let m: RegExpExecArray | null;
  let firstHost: number | undefined;
  while ((m = re.exec(ports)) !== null) {
    const host = Number(m[1]);
    const container = Number(m[2]);
    if (!Number.isFinite(host)) continue;
    if (firstHost === undefined) firstHost = host;
    if (containerPort === undefined || container === containerPort) {
      return host;
    }
  }
  // If a specific container port was requested but not matched, fall back to the first mapping.
  return firstHost;
}

/** Probe the running Docker container for a compose service and return its published host port. */
export function discoverDockerHostPort(
  service: string,
  containerPort?: number,
  exec: (cmd: string) => string = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
): number | undefined {
  try {
    const cmd = `docker ps --filter "label=com.docker.compose.service=${service}" --filter "status=running" --format "{{.Ports}}"`;
    const output = exec(cmd);
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const port = parseDockerPortMapping(line, containerPort);
      if (port) return port;
    }
  } catch {
    /* docker not running / not installed — fall back to env or default */
  }
  return undefined;
}

export interface HostPortResolveOptions {
  /** The service's internal container port (used to disambiguate multi-port mappings). */
  containerPort?: number;
  /** Value used when neither an env override nor a Docker probe yields a port. */
  fallback?: number;
  /** Env source (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Injectable Docker probe (tests). */
  discover?: (service: string, containerPort?: number) => number | undefined;
  /**
   * Full host-port resolver override. When provided, it is used verbatim (instead of the built-in
   * env → docker → fallback chain). Lets callers thread their own injectable resolver seam.
   */
  resolveHostPort?: (service: string, containerPort?: number) => number;
  logger?: Logger;
}

/**
 * Resolve the published host port for a local Docker compose service:
 *   1. explicit `<SERVICE>_HOST_PORT` env var,
 *   2. a live `docker ps` port-mapping probe,
 *   3. the supplied `fallback` (default 3001).
 */
export function resolveServiceHostPort(service: string, opts: HostPortResolveOptions = {}): number {
  const env = opts.env || process.env;
  const fallback = opts.fallback ?? 3001;
  const discover = opts.discover || discoverDockerHostPort;

  const envVar = hostPortEnvVar(service);
  const fromEnv = env[envVar];
  if (fromEnv && Number.isFinite(Number(fromEnv))) {
    const port = Number(fromEnv);
    opts.logger?.info(
      { action: 'fleet.docker.port_resolved', service, port, source: envVar },
      `Resolved ${service} host port ${port} from ${envVar}`,
    );
    return port;
  }

  const probed = discover(service, opts.containerPort);
  if (probed) {
    opts.logger?.info(
      { action: 'fleet.docker.port_resolved', service, port: probed, source: 'docker' },
      `Resolved ${service} host port ${probed} from a running Docker container`,
    );
    return probed;
  }

  opts.logger?.warn(
    { action: 'fleet.docker.port_fallback', service, port: fallback },
    `Could not resolve a published host port for ${service}; falling back to ${fallback}`,
  );
  return fallback;
}

/**
 * Rewrite a Bit's internal, registry-published URL (`http://<svc>.bitbrat.local:<containerPort>/sse`)
 * to the operator-reachable `http://localhost:<publishedHostPort>/sse` for a local Docker target. The
 * path/protocol are preserved; only host+port are remapped. If the URL cannot be parsed it is
 * returned unchanged (best-effort).
 */
export function rewriteToLocalHostPort(url: string, service: string, opts: HostPortResolveOptions = {}): string {
  try {
    const u = new URL(url);
    const containerPort = opts.containerPort ?? (u.port ? Number(u.port) : undefined);
    const hostPort = opts.resolveHostPort
      ? opts.resolveHostPort(service, containerPort)
      : resolveServiceHostPort(service, { ...opts, containerPort });
    u.hostname = 'localhost';
    u.port = String(hostPort);
    return u.toString();
  } catch {
    return url;
  }
}
