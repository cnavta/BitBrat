import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { execCmd } from '../exec';
import { DockerOrchestrator } from './orchestrator';

jest.mock('../exec', () => ({
  execCmd: jest.fn(),
}));

const execCmdMock = execCmd as jest.MockedFunction<typeof execCmd>;

function makeRepo(files: string[]): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-sync-'));
  for (const f of files) {
    const full = path.join(repoRoot, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '{}');
  }
  return repoRoot;
}

describe('DockerOrchestrator.syncRemoteFiles', () => {
  beforeEach(() => {
    execCmdMock.mockReset();
    execCmdMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' } as any);
  });

  it('syncs firestore.rules and firestore.indexes.json to the remote host', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
      '.env.brat',
      'firebase.json',
      'firestore.rules',
      'firestore.indexes.json',
    ]);

    const orch = new DockerOrchestrator({ repoRoot });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    await (orch as any).syncRemoteFiles(target);

    const rsyncCall = execCmdMock.mock.calls.find(([cmd]) => cmd === 'rsync');
    expect(rsyncCall).toBeDefined();
    const rsyncArgs = rsyncCall![1] as string[];
    expect(rsyncArgs).toContain('firestore.rules');
    expect(rsyncArgs).toContain('firestore.indexes.json');
    // Ensure firebase.json (which references the above) is still synced too.
    expect(rsyncArgs).toContain('firebase.json');
  });

  it('copies the real GCP ADC key to the remote host at the deterministic path', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
      '.env.brat',
    ]);

    // Create env/staging/global.yaml with Firestore config (testing Firestore path)
    const envDir = path.join(repoRoot, 'env', 'staging');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'global.yaml'),
      'PERSISTENCE_DRIVER: firestore\nMESSAGE_BUS_DRIVER: pubsub\n',
    );

    // Real SA key on the local machine, referenced via .secure.local.
    const keyPath = path.join(repoRoot, 'sa-key.json');
    fs.writeFileSync(keyPath, '{"type":"service_account"}');
    fs.writeFileSync(
      path.join(repoRoot, '.secure.local'),
      `GOOGLE_APPLICATION_CREDENTIALS=${keyPath}\n`,
    );

    const orch = new DockerOrchestrator({ repoRoot, target: 'staging', env: 'staging' });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    await (orch as any).syncRemoteFiles(target);

    const remoteKeyPath = '/remote/dir/secrets/google-app-creds.json';
    const scpKeyCall = execCmdMock.mock.calls.find(
      ([cmd, args]) =>
        cmd === 'scp' &&
        Array.isArray(args) &&
        args[0] === keyPath &&
        args[1] === `user@example:${remoteKeyPath}`,
    );
    expect(scpKeyCall).toBeDefined();

    const mkdirCall = execCmdMock.mock.calls.find(
      ([cmd, args]) =>
        cmd === 'ssh' &&
        Array.isArray(args) &&
        typeof args[1] === 'string' &&
        args[1].includes('mkdir -p "/remote/dir/secrets"'),
    );
    expect(mkdirCall).toBeDefined();
  });

  it('warns and continues when the configured ADC key does not exist locally', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
      '.env.brat',
    ]);

    // Create env/staging/global.yaml with Firestore config (testing Firestore path)
    const envDir = path.join(repoRoot, 'env', 'staging');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'global.yaml'),
      'PERSISTENCE_DRIVER: firestore\nMESSAGE_BUS_DRIVER: pubsub\n',
    );

    fs.writeFileSync(
      path.join(repoRoot, '.secure.local'),
      `GOOGLE_APPLICATION_CREDENTIALS=${path.join(repoRoot, 'missing-key.json')}\n`,
    );

    const orch = new DockerOrchestrator({ repoRoot, target: 'staging', env: 'staging' });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    // Spy on console.warn to verify warning is issued
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await expect((orch as any).syncRemoteFiles(target)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GOOGLE_APPLICATION_CREDENTIALS is set'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('but file does not exist'),
    );

    warnSpy.mockRestore();
  });

  it('skips GCP credentials sync when using PostgreSQL and NATS', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
      '.env.brat',
    ]);

    // Create env/staging/global.yaml with PostgreSQL and NATS
    const envDir = path.join(repoRoot, 'env', 'staging');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'global.yaml'),
      'PERSISTENCE_DRIVER: postgres\nMESSAGE_BUS_DRIVER: nats\n',
    );

    // Set up GCP credentials (they exist but should not be synced)
    const keyPath = path.join(repoRoot, 'sa-key.json');
    fs.writeFileSync(keyPath, '{"type":"service_account"}');
    fs.writeFileSync(
      path.join(repoRoot, '.secure.local'),
      `GOOGLE_APPLICATION_CREDENTIALS=${keyPath}\n`,
    );

    const orch = new DockerOrchestrator({ repoRoot, target: 'staging', env: 'staging' });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    // Spy on console.log to verify skip message
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await (orch as any).syncRemoteFiles(target);

    // Verify skip message was logged
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping GCP credentials sync'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('PERSISTENCE_DRIVER=postgres'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('MESSAGE_BUS_DRIVER=nats'),
    );

    // Verify no scp command was executed
    const scpCall = execCmdMock.mock.calls.find(([cmd]) => cmd === 'scp');
    expect(scpCall).toBeUndefined();

    logSpy.mockRestore();
  });
});

describe('DockerOrchestrator.writeEnvFile ADC path', () => {
  beforeEach(() => {
    execCmdMock.mockReset();
    execCmdMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' } as any);
  });

  it('rewrites GOOGLE_APPLICATION_CREDENTIALS to the remote path for ssh targets', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
    ]);
    const keyPath = path.join(repoRoot, 'sa-key.json');
    fs.writeFileSync(keyPath, '{}');
    fs.writeFileSync(
      path.join(repoRoot, '.secure.local'),
      `GOOGLE_APPLICATION_CREDENTIALS=${keyPath}\n`,
    );

    const orch = new DockerOrchestrator({ repoRoot, target: 'staging', env: 'staging' });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    await (orch as any).writeEnvFile('staging', target);

    const envContent = fs.readFileSync(path.join(repoRoot, '.env.brat'), 'utf8');
    expect(envContent).toContain(
      'GOOGLE_APPLICATION_CREDENTIALS=/remote/dir/secrets/google-app-creds.json',
    );
    expect(envContent).not.toContain(`GOOGLE_APPLICATION_CREDENTIALS=${keyPath}`);
  });

  it('leaves GOOGLE_APPLICATION_CREDENTIALS untouched for local targets', async () => {
    const repoRoot = makeRepo([
      'infrastructure/docker-compose/docker-compose.local.yaml',
    ]);
    const keyPath = path.join(repoRoot, 'sa-key.json');
    fs.writeFileSync(keyPath, '{}');
    fs.writeFileSync(
      path.join(repoRoot, '.secure.local'),
      `GOOGLE_APPLICATION_CREDENTIALS=${keyPath}\n`,
    );

    const orch = new DockerOrchestrator({ repoRoot, target: 'local', env: 'local' });
    const target = { host: 'unix:///var/run/docker.sock' };

    await (orch as any).writeEnvFile('local', target);

    const envContent = fs.readFileSync(path.join(repoRoot, '.env.brat'), 'utf8');
    expect(envContent).toContain(`GOOGLE_APPLICATION_CREDENTIALS=${keyPath}`);
  });
});
