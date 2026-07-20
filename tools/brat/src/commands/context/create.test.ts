/**
 * Tests for 'brat context create' command
 */

import { executeContextCreate } from './create';
import { ContextResolver } from '../../context/context-resolver';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// Mock console methods
const mockLog = jest.spyOn(console, 'log').mockImplementation();
const mockError = jest.spyOn(console, 'error').mockImplementation();
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  return undefined as never;
});

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('brat context create', () => {
  const mockRepoRoot = '/mock/repo';
  const mockArchPath = '/mock/repo/architecture.yaml';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock process.cwd()
    jest.spyOn(process, 'cwd').mockReturnValue(mockRepoRoot);

    // Mock ContextResolver
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockResolvedValue(undefined);

    // Mock fs.readFileSync to return base architecture.yaml
    mockFs.readFileSync.mockReturnValue(yaml.dump({
      version: '1.0.0',
      executionContexts: {
        local: {
          description: 'Local development',
          deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
          runtime: { persistence: { driver: 'postgres', autoDiscover: true } },
        },
      },
    }));

    // Mock fs.writeFileSync
    mockFs.writeFileSync.mockImplementation();
  });

  it('creates docker-compose context in non-interactive mode', async () => {
    await executeContextCreate('test-docker', {
      nonInteractive: true,
      type: 'docker-compose',
      description: 'Test Docker context',
      dockerHost: 'ssh://user@example.com',
      dockerRemoteDir: '/opt/app',
      persistenceDriver: 'postgres',
      pgHost: 'db.example.com',
      pgPort: 5432,
      pgDatabase: 'testdb',
      pgUsername: 'testuser',
      pgPassword: 'testpass',
      gatewayUrl: 'http://example.com:3000',
      gatewayAuthToken: '${TOKEN}',
      envPath: 'env/test-docker',
      tags: 'test,docker',
    });

    // Should write to architecture.yaml
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      mockArchPath,
      expect.any(String),
      'utf8'
    );

    // Verify written content
    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-docker']).toBeDefined();
    expect(parsed.executionContexts['test-docker'].description).toBe('Test Docker context');
    expect(parsed.executionContexts['test-docker'].deployment.type).toBe('docker-compose');
    expect(parsed.executionContexts['test-docker'].deployment.docker.host).toBe('ssh://user@example.com');
    expect(parsed.executionContexts['test-docker'].deployment.docker.remoteDir).toBe('/opt/app');
    expect(parsed.executionContexts['test-docker'].runtime.persistence.driver).toBe('postgres');
    expect(parsed.executionContexts['test-docker'].runtime.persistence.connection.host).toBe('db.example.com');
    expect(parsed.executionContexts['test-docker'].runtime.gateway.url).toBe('http://example.com:3000');
    expect(parsed.executionContexts['test-docker'].tags).toEqual(['test', 'docker']);
  });

  it('creates cloud-run context in non-interactive mode', async () => {
    await executeContextCreate('test-gcp', {
      nonInteractive: true,
      type: 'cloud-run',
      description: 'Test GCP context',
      gcpProject: 'my-project',
      gcpRegion: 'us-west1',
      persistenceDriver: 'postgres',
      pgHost: 'cloudsql-instance',
      gatewayUrl: 'https://gateway.example.com',
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-gcp'].deployment.type).toBe('cloud-run');
    expect(parsed.executionContexts['test-gcp'].deployment.gcp.project).toBe('my-project');
    expect(parsed.executionContexts['test-gcp'].deployment.gcp.region).toBe('us-west1');
  });

  it('uses auto-discover for postgres when no connection provided', async () => {
    await executeContextCreate('test-auto', {
      nonInteractive: true,
      type: 'docker-compose',
      dockerHost: 'unix:///var/run/docker.sock',
      persistenceDriver: 'postgres',
      // No pgHost provided - should auto-discover
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-auto'].runtime.persistence.autoDiscover).toBe(true);
    expect(parsed.executionContexts['test-auto'].runtime.persistence.connection).toBeUndefined();
  });

  it('uses auto-discover for gateway when no URL provided', async () => {
    await executeContextCreate('test-gateway-auto', {
      nonInteractive: true,
      type: 'docker-compose',
      dockerHost: 'unix:///var/run/docker.sock',
      persistenceDriver: 'postgres',
      // No gatewayUrl provided - should auto-discover
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-gateway-auto'].runtime.gateway.autoDiscover).toBe(true);
    expect(parsed.executionContexts['test-gateway-auto'].runtime.gateway.fallbackPort).toBe(3004);
  });

  it('rejects creating context that already exists', async () => {
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockResolvedValue({
      description: 'Existing context',
      deployment: { type: 'docker-compose' },
      runtime: { persistence: { driver: 'postgres' } },
    } as any);

    await executeContextCreate('existing', { nonInteractive: true });

    expect(mockError).toHaveBeenCalledWith("Error: Context 'existing' already exists");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('handles errors gracefully', async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    await executeContextCreate('test-error', { nonInteractive: true });

    expect(mockError).toHaveBeenCalledWith('Error creating context: Permission denied');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('preserves existing contexts when adding new one', async () => {
    await executeContextCreate('test-preserve', {
      nonInteractive: true,
      type: 'docker-compose',
      dockerHost: 'unix:///var/run/docker.sock',
      persistenceDriver: 'postgres',
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    // Should preserve 'local' context
    expect(parsed.executionContexts.local).toBeDefined();
    expect(parsed.executionContexts.local.description).toBe('Local development');

    // Should add new 'test-preserve' context
    expect(parsed.executionContexts['test-preserve']).toBeDefined();
  });

  it('uses firestore driver when specified', async () => {
    await executeContextCreate('test-firestore', {
      nonInteractive: true,
      type: 'docker-compose',
      dockerHost: 'unix:///var/run/docker.sock',
      persistenceDriver: 'firestore',
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-firestore'].runtime.persistence.driver).toBe('firestore');
    expect(parsed.executionContexts['test-firestore'].runtime.persistence.autoDiscover).toBe(true);
  });

  it('defaults to docker-compose and postgres when minimal options provided', async () => {
    await executeContextCreate('test-defaults', {
      nonInteractive: true,
    });

    const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1];
    const parsed = yaml.load(writtenContent) as any;

    expect(parsed.executionContexts['test-defaults'].deployment.type).toBe('docker-compose');
    expect(parsed.executionContexts['test-defaults'].runtime.persistence.driver).toBe('postgres');
  });

  it('shows helpful success message with next steps', async () => {
    await executeContextCreate('test-success', {
      nonInteractive: true,
    });

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    expect(output).toContain("Context 'test-success' created successfully");
    expect(output).toContain('brat context show test-success');
    expect(output).toContain('brat use test-success');
    expect(output).toContain('brat context ping test-success');
  });
});
