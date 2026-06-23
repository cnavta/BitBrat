import {
  parseEmulatorPort,
  resolveTargetEndpoint,
  resolveBackupConnection,
} from '../connection';
import { ConfigurationError } from '../../orchestration/errors';

const INFRA_LOCAL = {
  FIRESTORE_EMULATOR_HOST: 'firebase-emulator:8080',
  GCLOUD_PROJECT: 'bitbrat-local',
};

describe('backup connection — deployment-target resolution (Gate G5)', () => {
  it('parses the published emulator port', () => {
    expect(parseEmulatorPort('firebase-emulator:8080')).toBe(8080);
    expect(parseEmulatorPort('host:9999')).toBe(9999);
    expect(parseEmulatorPort(undefined)).toBe(8080);
  });

  it('resolves a local docker-engine target to localhost:<port>', () => {
    const ep = resolveTargetEndpoint('local',
      { type: 'docker-engine', host: 'unix:///var/run/docker.sock', env: 'local' }, INFRA_LOCAL);
    expect(ep.kind).toBe('local');
    expect(ep.directHostPort).toBe('localhost:8080');
    expect(ep.project).toBe('bitbrat-local');
    expect(ep.sshTarget).toBeUndefined();
  });

  it('resolves a remote ssh docker-engine target to an ssh target + direct fallback', () => {
    const ep = resolveTargetEndpoint('staging',
      { type: 'docker-engine', host: 'ssh://root@bitbrat.lan', env: 'staging' }, INFRA_LOCAL);
    expect(ep.kind).toBe('remote');
    expect(ep.sshTarget).toBe('root@bitbrat.lan');
    expect(ep.remoteHost).toBe('bitbrat.lan');
    expect(ep.directHostPort).toBe('bitbrat.lan:8080');
  });

  it('throws for a non docker-engine target type', () => {
    expect(() => resolveTargetEndpoint('weird',
      { type: 'kubernetes', host: 'x', env: 'y' } as any, INFRA_LOCAL)).toThrow(ConfigurationError);
  });

  it('resolves --target local against the real architecture.yaml (no ssh, emulator endpoint)', async () => {
    const conn = await resolveBackupConnection({ projectId: 'ignored' }, { target: 'local' });
    expect(conn.isEmulator).toBe(true);
    expect(conn.targetName).toBe('local');
    expect(conn.connectOptions.emulatorHost).toBe('localhost:8080');
    expect(conn.connectOptions.projectId).toBe('bitbrat-local');
    expect(conn.cleanup).toBeUndefined();
  });

  it('throws for an unknown --target', async () => {
    await expect(resolveBackupConnection({}, { target: 'does-not-exist' })).rejects.toThrow(ConfigurationError);
  });

  it('resolves a GCP target (no --target, no emulator host)', async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      const conn = await resolveBackupConnection({ projectId: 'my-proj' }, {});
      expect(conn.isEmulator).toBe(false);
      expect(conn.connectOptions.projectId).toBe('my-proj');
      expect(conn.description).toContain('GCP Firestore');
    } finally {
      if (saved !== undefined) process.env.FIRESTORE_EMULATOR_HOST = saved;
    }
  });

  it('treats an explicit emulator-host (no --target) as an emulator target', async () => {
    const conn = await resolveBackupConnection({ projectId: 'p' }, { 'emulator-host': '127.0.0.1:9000' });
    expect(conn.isEmulator).toBe(true);
    expect(conn.connectOptions.emulatorHost).toBe('127.0.0.1:9000');
  });
});
