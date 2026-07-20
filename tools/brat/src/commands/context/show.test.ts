/**
 * Tests for 'brat context show' command
 */

import { executeContextShow } from './show';
import { ContextResolver } from '../../context/context-resolver';

// Mock console methods
const mockLog = jest.spyOn(console, 'log').mockImplementation();
const mockError = jest.spyOn(console, 'error').mockImplementation();
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  return undefined as never;
});

describe('brat context show', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ContextResolver
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockImplementation(async (name: string) => {
      const contexts: Record<string, any> = {
        staging: {
          description: 'Remote staging environment on bitbrat.lan',
          deployment: {
            type: 'docker-compose',
            docker: {
              host: 'ssh://root@bitbrat.lan',
              remoteDir: '/opt/BitBratPlatform',
              maxConcurrent: 3,
            },
          },
          runtime: {
            gateway: {
              autoDiscover: true,
              authToken: 'secret-token-12345',
            },
            persistence: {
              driver: 'postgres',
              connection: {
                host: 'bitbrat.lan',
                port: 5432,
                database: 'bitbrat',
                username: 'bitbrat',
                password: 'super-secret-password',
              },
            },
            envOverlay: {
              path: 'env/staging',
              files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
              secure: '.secure.staging',
            },
          },
          tags: ['staging', 'remote'],
        },
      };
      return contexts[name];
    });

    jest.spyOn(ContextResolver.prototype, 'listContexts').mockResolvedValue(['local', 'staging', 'prod']);
  });

  it('displays context configuration as YAML', async () => {
    await executeContextShow('staging');

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Should show header
    expect(output).toContain('# Execution Context: staging');
    expect(output).toContain('# (Sensitive values redacted');

    // Should show deployment config
    expect(output).toContain('deployment:');
    expect(output).toContain('type: docker-compose');

    // Should show runtime config
    expect(output).toContain('runtime:');
    expect(output).toContain('gateway:');
    expect(output).toContain('persistence:');
  });

  it('redacts sensitive values by default', async () => {
    await executeContextShow('staging');

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Should redact password
    expect(output).not.toContain('super-secret-password');
    expect(output).toMatch(/password:.*\*{8}/);

    // Should redact authToken
    expect(output).not.toContain('secret-token-12345');
    expect(output).toMatch(/authToken:.*\*{8}/);

    // Should NOT redact non-sensitive values
    expect(output).toContain('bitbrat.lan');
    expect(output).toContain('postgres');
  });

  it('shows raw values when --raw is specified', async () => {
    await executeContextShow('staging', { raw: true });

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Should NOT have redaction warning
    expect(output).not.toContain('Sensitive values redacted');

    // Should show actual password
    expect(output).toContain('super-secret-password');

    // Should show actual authToken
    expect(output).toContain('secret-token-12345');
  });

  it('shows helpful error when context not found', async () => {
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockResolvedValue(undefined);

    await executeContextShow('nonexistent');

    expect(mockError).toHaveBeenCalledWith("Error: Context 'nonexistent' not found");
    expect(mockError).toHaveBeenCalledWith('\nAvailable contexts:');
    expect(mockError).toHaveBeenCalledWith('  - local');
    expect(mockError).toHaveBeenCalledWith('  - staging');
    expect(mockError).toHaveBeenCalledWith('  - prod');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('handles errors gracefully', async () => {
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockRejectedValue(
      new Error('architecture.yaml not found')
    );

    await executeContextShow('staging');

    expect(mockError).toHaveBeenCalledWith('Error showing context: architecture.yaml not found');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('redacts nested sensitive values', async () => {
    // Use 'as any' to bypass strict type checking for test mock
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockResolvedValue({
      deployment: { type: 'docker-compose' },
      runtime: {
        gateway: {
          authToken: 'my-secret-token',
        },
        persistence: {
          driver: 'postgres',
          connection: {
            host: 'localhost',
            port: 5432,
            database: 'test',
            username: 'user',
            password: 'nested-password',
          },
        },
      },
      // Test apiKey redaction in metadata (outside strict schema)
      metadata: {
        apiKey: 'api-key-value',
        secretKey: 'secret-123',
      },
    } as any);

    await executeContextShow('test');

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Should redact nested password
    expect(output).not.toContain('nested-password');

    // Should redact apiKey
    expect(output).not.toContain('api-key-value');

    // Should redact secretKey
    expect(output).not.toContain('secret-123');

    // Should redact authToken
    expect(output).not.toContain('my-secret-token');
  });

  it('preserves first 2 characters of redacted values for identification', async () => {
    await executeContextShow('staging');

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Password should show first 2 chars: "su********"
    expect(output).toMatch(/password:.*su\*{8}/);

    // AuthToken should show first 2 chars: "se********"
    expect(output).toMatch(/authToken:.*se\*{8}/);
  });
});
