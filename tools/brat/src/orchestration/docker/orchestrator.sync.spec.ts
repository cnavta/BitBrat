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
});
