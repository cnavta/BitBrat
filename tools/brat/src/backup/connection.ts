import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import yaml from 'js-yaml';
import { loadArchitecture } from '../config/loader';
import { ConfigurationError } from '../orchestration/errors';
import type { Logger } from '../orchestration/logger';
import { FirestoreConnectOptions } from '../providers/gcp/firestore';

/**
 * Deployment-target-aware connection resolution (Technical Architecture §7.1/§7.2 refinement,
 * folded in during the planning gate).
 *
 * - `--target <name>` resolves a `docker-engine` deployment target from `architecture.yaml` to the
 *   **published Firestore emulator** endpoint (these stacks run the emulator, not real GCP):
 *     - local (unix socket) -> localhost:<published port>
 *     - remote (ssh://user@host) -> an SSH tunnel to the published port (preferred), or a direct
 *       host:port fallback.
 * - Otherwise `--project-id` / `--env` / FIRESTORE_EMULATOR_HOST select a real GCP database (or an
 *   explicitly provided emulator host).
 */

export interface ResolvedBackupConnection {
  connectOptions: FirestoreConnectOptions;
  /** True when the resolved target is a Firestore emulator (relaxes the GCP project match check). */
  isEmulator: boolean;
  /** The deployment target name, when --target was used. */
  targetName?: string;
  /** A short human description of the resolved endpoint, echoed before any op. */
  description: string;
  /** Tear down any resources (e.g. an SSH tunnel) opened during resolution. */
  cleanup?: () => Promise<void>;
}

export interface TargetEndpoint {
  kind: 'local' | 'remote';
  /** Direct host:port reachable from the operator's machine (fallback for remote). */
  directHostPort: string;
  /** Emulator (published) port. */
  port: number;
  project: string;
  /** For remote: the ssh login target (user@host) and remote hostname. */
  sshTarget?: string;
  remoteHost?: string;
}

/** Extract the port from an emulator host string like "firebase-emulator:8080". Defaults to 8080. */
export function parseEmulatorPort(emulatorHost: string | undefined): number {
  if (!emulatorHost) return 8080;
  const parts = String(emulatorHost).split(':');
  const port = Number(parts[parts.length - 1]);
  return Number.isFinite(port) && port > 0 ? port : 8080;
}

function loadInfraEnv(repoRoot: string, envName: string): Record<string, any> {
  const file = path.join(repoRoot, 'env', envName, 'infra.yaml');
  try {
    if (fs.existsSync(file)) {
      return (yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, any>) || {};
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

/**
 * Pure derivation of the emulator endpoint for a deployment target (no side effects / no ssh).
 * Exported for unit testing.
 */
export function resolveTargetEndpoint(
  targetName: string,
  targetConfig: { type: string; host: string; env: string },
  infraEnv: Record<string, any>,
): TargetEndpoint {
  if (targetConfig.type !== 'docker-engine') {
    throw new ConfigurationError(`Deployment target '${targetName}' is not a docker-engine target.`);
  }
  const port = parseEmulatorPort(infraEnv.FIRESTORE_EMULATOR_HOST);
  const project = String(infraEnv.GCLOUD_PROJECT || infraEnv.GOOGLE_CLOUD_PROJECT || infraEnv.FIREBASE_PROJECT_ID || 'bitbrat-local');
  const host = targetConfig.host || '';

  if (host.startsWith('ssh://')) {
    const sshTarget = host.replace('ssh://', '');
    const remoteHost = sshTarget.includes('@') ? sshTarget.split('@')[1] : sshTarget;
    return {
      kind: 'remote',
      directHostPort: `${remoteHost}:${port}`,
      port,
      project,
      sshTarget,
      remoteHost,
    };
  }

  // local (unix socket) or any non-ssh engine: the published port is reachable on localhost.
  return { kind: 'local', directHostPort: `localhost:${port}`, port, project };
}

async function isReachable(hostPort: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const [host, portStr] = hostPort.split(':');
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; socket.destroy(); resolve(ok); } };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(portStr || 8080), host || '127.0.0.1');
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('Could not allocate a free port'))));
    });
    srv.on('error', reject);
  });
}

/**
 * Open an SSH tunnel from a local port to the remote published emulator port. Returns the local
 * endpoint and a cleanup function. Throws if the tunnel does not come up within the timeout.
 */
export async function openSshTunnel(
  endpoint: TargetEndpoint,
  logger?: Logger,
  readyTimeoutMs = 7000,
): Promise<{ hostPort: string; cleanup: () => Promise<void> }> {
  if (!endpoint.sshTarget) throw new ConfigurationError('openSshTunnel requires a remote endpoint with an ssh target.');
  const localPort = await getFreePort();
  const args = ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-L', `${localPort}:localhost:${endpoint.port}`, endpoint.sshTarget];
  logger?.info({ action: 'backup.tunnel.open', sshTarget: endpoint.sshTarget, localPort, remotePort: endpoint.port },
    `Opening SSH tunnel 127.0.0.1:${localPort} -> ${endpoint.sshTarget}:${endpoint.port}`);
  const child: ChildProcess = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (d) => { stderr += String(d); });

  const cleanup = async () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  };

  const localHostPort = `127.0.0.1:${localPort}`;
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ConfigurationError(`SSH tunnel exited early (code ${child.exitCode}): ${stderr.trim()}`);
    }
    if (await isReachable(localHostPort, 500)) {
      return { hostPort: localHostPort, cleanup };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await cleanup();
  throw new ConfigurationError(`SSH tunnel to ${endpoint.sshTarget} did not become ready within ${readyTimeoutMs}ms.`);
}

/**
 * Resolve the Firestore connection from CLI flags. `m` is the parsed key/value flag map (rest).
 */
export async function resolveBackupConnection(
  flags: { projectId?: string; env?: string },
  m: Record<string, string>,
  logger?: Logger,
  repoRoot: string = process.cwd(),
): Promise<ResolvedBackupConnection> {
  const targetName = m['target'];

  if (targetName) {
    const arch: any = loadArchitecture(repoRoot);
    const tc = arch.deploymentTargets?.[targetName];
    if (!tc) {
      throw new ConfigurationError(`Deployment target '${targetName}' not found in architecture.yaml.`);
    }
    const infraEnv = loadInfraEnv(repoRoot, tc.env || targetName);
    const endpoint = resolveTargetEndpoint(targetName, tc, infraEnv);

    let hostPort = endpoint.directHostPort;
    let cleanup: (() => Promise<void>) | undefined;

    if (endpoint.kind === 'remote') {
      // Prefer an SSH tunnel (the engine is already addressed over SSH); fall back to direct.
      try {
        const tunnel = await openSshTunnel(endpoint, logger);
        hostPort = tunnel.hostPort;
        cleanup = tunnel.cleanup;
      } catch (e: any) {
        logger?.warn({ action: 'backup.tunnel.fallback', error: e?.message || String(e), fallback: endpoint.directHostPort },
          `SSH tunnel failed; falling back to direct ${endpoint.directHostPort}`);
        hostPort = endpoint.directHostPort;
      }
    }

    return {
      connectOptions: { emulatorHost: hostPort, projectId: endpoint.project, databaseId: '(default)' },
      isEmulator: true,
      targetName,
      description: `target '${targetName}' -> Firestore emulator ${hostPort} (project '${endpoint.project}')`,
      cleanup,
    };
  }

  // No --target: GCP (ADC) or an explicitly-provided emulator host.
  const emulatorHost = (m['emulator-host'] || process.env.FIRESTORE_EMULATOR_HOST || '').trim() || undefined;
  const projectId = m['project-id'] || flags.projectId;
  const databaseId = m['database'];
  return {
    connectOptions: { projectId, databaseId, emulatorHost },
    isEmulator: !!emulatorHost,
    description: emulatorHost
      ? `Firestore emulator ${emulatorHost} (project '${projectId}')`
      : `GCP Firestore (project '${projectId}', database '${databaseId || '(default)'}')`,
  };
}
