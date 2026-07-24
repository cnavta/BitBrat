/**
 * Sprint 349: ContextResolver Integration Tests
 *
 * Comprehensive integration tests covering full context resolution workflows.
 * Tests the entire stack: priority resolution, auto-discovery, env overlays.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ContextResolver } from '../../context/context-resolver';
import type { Architecture } from '../../config/schema';

// Mock fs, os, and child_process
jest.mock('fs');
jest.mock('os');
jest.mock('child_process');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

// Import execSync after mocking
import { execSync } from 'child_process';
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('ContextResolver Integration Tests - Sprint 349', () => {
  let resolver: ContextResolver;
  const testRepoRoot = '/test/repo';

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new ContextResolver(testRepoRoot);
    mockOs.homedir.mockReturnValue('/home/testuser');
  });

  describe('Full Resolution Workflow - Explicit Context', () => {
    it('resolves local context with explicit --context flag', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: {
                fallbackPort: 3004,
              },
              persistence: {
                driver: 'postgres',
                connection: {
                  host: 'localhost',
                  port: 5432,
                  database: 'bitbrat',
                  username: 'bitbrat',
                  password: 'secret',
                },
              },
              envOverlay: {
                path: 'env/local',
                files: ['global.yaml', 'infra.yaml'],
              },
            },
          },
        },
      };

      // Mock architecture.yaml
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        if (String(path).includes('global.yaml')) {
          return yaml.dump({ LOG_LEVEL: 'debug', SERVICE_PORT: 3000 });
        }
        if (String(path).includes('infra.yaml')) {
          return yaml.dump({ DATABASE_HOST: 'localhost' });
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // Mock docker commands for auto-discovery
      mockExecSync.mockImplementation((cmd: any) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes('docker ps')) {
          return '0.0.0.0:3004->3000/tcp\n' as any;
        }
        if (cmdStr.includes('docker inspect')) {
          const output = JSON.stringify([
            'POSTGRES_USER=bitbrat',
            'POSTGRES_PASSWORD=secret',
            'POSTGRES_DB=bitbrat',
          ]);
          return output as any;
        }
        return '' as any;
      });

      const result = await resolver.resolve('local');

      // Verify full resolution
      expect(result.name).toBe('local');
      expect(result.deployment.type).toBe('docker-compose');
      expect(result.runtime.gateway.url).toBe('ws://localhost:3004/ws/v1');
      expect(result.runtime.persistence.driver).toBe('postgres');
      expect(result.runtime.persistence.connection?.host).toBe('localhost');
      expect(result.runtime.persistence.connection?.database).toBe('bitbrat');
      expect(result.runtime.persistence.connection?.password).toBe('secret');
      expect(result.runtime.envVars.LOG_LEVEL).toBe('debug');
      expect(result.runtime.envVars.DATABASE_HOST).toBe('localhost');
    });

    it('resolves staging context with SSH host', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          staging: {
            deployment: {
              type: 'docker-compose',
              docker: { host: 'ssh://root@bitbrat.lan' },
            },
            runtime: {
              gateway: {
                fallbackPort: 3002,
              },
              persistence: {
                driver: 'postgres',
                connection: {
                  host: 'bitbrat.lan',
                  port: 5432,
                  database: 'staging_db',
                  username: 'staging_user',
                  password: 'staging_pass',
                },
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // Mock remote docker commands (SSH)
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes('ssh root@bitbrat.lan')) {
          if (String(cmd).includes('docker ps')) {
            return '0.0.0.0:3002->3000/tcp\n' as any;
          }
          if (String(cmd).includes('docker inspect')) {
            return JSON.stringify([
              'POSTGRES_USER=staging_user',
              'POSTGRES_PASSWORD=staging_pass',
              'POSTGRES_DB=staging_db',
            ]) as any;
          }
        }
        return '' as any;
      });

      const result = await resolver.resolve('staging');

      expect(result.name).toBe('staging');
      expect(result.runtime.gateway.url).toBe('ws://bitbrat.lan:3002/ws/v1');
      expect(result.runtime.persistence.connection?.host).toBe('bitbrat.lan');
      expect(result.runtime.persistence.connection?.database).toBe('staging_db');
      expect(result.runtime.persistence.connection?.username).toBe('staging_user');
    });
  });

  describe('Priority Resolution Workflow', () => {
    it('uses BITBRAT_CONTEXT env var when no explicit context', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // Set BITBRAT_CONTEXT env var
      process.env.BITBRAT_CONTEXT = 'staging';

      const result = await resolver.resolve();

      expect(result.name).toBe('staging');

      delete process.env.BITBRAT_CONTEXT;
    });

    it('uses ~/.bratrc current_context when no env var', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          prod: {
            deployment: { type: 'cloud-run', gcp: { region: 'us-central1', project: 'bitbrat-prod' } },
            runtime: {
              gateway: { url: 'wss://api.example.com/ws/v1' },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        if (String(path).includes('.bratrc')) {
          return 'current_context: prod\n';
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve();

      expect(result.name).toBe('prod');
    });

    it('defaults to local when no explicit context, env var, or ~/.bratrc', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockImplementation((path: any) => {
        if (String(path).includes('.bratrc')) return false;
        return true;
      });
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve();

      expect(result.name).toBe('local');
    });

    it('explicit --context overrides all other sources', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@bitbrat.lan' } },
            runtime: {
              gateway: { fallbackPort: 3002 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        if (String(path).includes('.bratrc')) {
          return 'current_context: local\n';
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      process.env.BITBRAT_CONTEXT = 'local';

      // Explicit context should override env var and ~/.bratrc
      const result = await resolver.resolve('staging');

      expect(result.name).toBe('staging');

      delete process.env.BITBRAT_CONTEXT;
    });
  });

  describe('Fallback Integration', () => {
    it('uses fallback port when gateway URL not explicitly configured', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');

      // Uses fallback port
      expect(result.runtime.gateway.url).toBe('ws://localhost:3000/ws/v1');
      expect(result.runtime.persistence.driver).toBe('firestore');
    });

    it('falls back to explicit config when auto-discovery fails', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { autoDiscover: true, fallbackPort: 3000 },
              persistence: {
                driver: 'postgres',
                autoDiscover: true,
                connection: {
                  host: 'localhost',
                  port: 5432,
                  database: 'bitbrat',
                  username: 'bitbrat',
                  password: 'fallback_password',
                },
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // Mock docker commands to fail
      mockExecSync.mockImplementation(() => {
        throw new Error('Docker not running');
      });

      const result = await resolver.resolve('local');

      // Gateway falls back to fallbackPort
      expect(result.runtime.gateway.url).toBe('ws://localhost:3000/ws/v1');

      // Persistence falls back to explicit connection
      expect(result.runtime.persistence.connection?.password).toBe('fallback_password');
    });
  });

  describe('Environment Overlay Integration', () => {
    it('merges global, infra, and service-specific YAML files', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
              envOverlay: {
                path: 'env/local',
                files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        if (String(path).includes('global.yaml')) {
          return yaml.dump({ LOG_LEVEL: 'info', PORT: 3000, ENV: 'local' });
        }
        if (String(path).includes('infra.yaml')) {
          return yaml.dump({ DATABASE_HOST: 'localhost', PORT: 5432 });
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');

      // Verify merging (later files override earlier)
      expect(result.runtime.envVars.LOG_LEVEL).toBe('info');
      expect(result.runtime.envVars.PORT).toBe('5432'); // Overridden by infra.yaml
      expect(result.runtime.envVars.ENV).toBe('local');
      expect(result.runtime.envVars.DATABASE_HOST).toBe('localhost');
    });

    it('loads .secure.* file with highest priority', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
              envOverlay: {
                path: 'env/local',
                files: ['global.yaml'],
                secure: '.secure.local',
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockImplementation((path: any) => {
        if (String(path).includes('architecture.yaml')) {
          return yaml.dump(arch);
        }
        if (String(path).includes('global.yaml')) {
          return yaml.dump({ API_KEY: 'public_key', LOG_LEVEL: 'info' });
        }
        if (String(path).includes('.secure.local')) {
          return 'API_KEY=super_secret_key\nSECRET_TOKEN=token123\n';
        }
        return '';
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');

      // .secure.local overrides global.yaml
      expect(result.runtime.envVars.API_KEY).toBe('super_secret_key');
      expect(result.runtime.envVars.SECRET_TOKEN).toBe('token123');
      expect(result.runtime.envVars.LOG_LEVEL).toBe('info');
    });
  });

  describe('Error Cases', () => {
    it('throws error when context not found', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('nonexistent')).rejects.toThrow(
        "Unknown execution context: 'nonexistent'"
      );
    });

    it('throws error when architecture.yaml not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(resolver.resolve('local')).rejects.toThrow('architecture.yaml not found');
    });

    it('throws error when no gateway resolution method available', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          broken: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: {}, // No url, autoDiscover, or fallbackPort
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('broken')).rejects.toThrow(
        'Cannot resolve gateway URL for context'
      );
    });

    it('throws error when postgres has no connection and no autoDiscover', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          broken: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: {
                driver: 'postgres',
                // No connection, no autoDiscover
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('broken')).rejects.toThrow(
        'Cannot resolve PostgreSQL persistence'
      );
    });
  });

  describe('Caching Integration', () => {
    it('caches resolved contexts and reuses them', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // First call
      await resolver.resolve('local');
      const firstReadCount = mockFs.readFileSync.mock.calls.length;

      // Second call (should use cache)
      await resolver.resolve('local');
      const secondReadCount = mockFs.readFileSync.mock.calls.length;

      // Should not read file again
      expect(secondReadCount).toBe(firstReadCount);
    });

    it('invalidates cache when architecture.yaml modified', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      // First call
      await resolver.resolve('local');

      // Modify mtime
      mockFs.statSync.mockReturnValue({ mtimeMs: 789012 } as fs.Stats);

      // Second call (should reload)
      await resolver.resolve('local');

      // Should read file again (2 reads per call: architecture.yaml + ephemeral-contexts.yaml)
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(4);
    });
  });

  describe('Utility Methods Integration', () => {
    it('listContexts returns all available contexts', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@bitbrat.lan' } },
            runtime: {
              gateway: { fallbackPort: 3002 },
              persistence: { driver: 'firestore' },
            },
          },
          prod: {
            deployment: { type: 'cloud-run', gcp: { region: 'us-central1', project: 'bitbrat-prod' } },
            runtime: {
              gateway: { url: 'wss://api.example.com/ws/v1' },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const contexts = await resolver.listContexts();

      expect(contexts).toEqual(['local', 'staging', 'prod']);
    });

    it('contextExists returns true for existing context', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      expect(await resolver.contextExists('local')).toBe(true);
      expect(await resolver.contextExists('nonexistent')).toBe(false);
    });
  });
});
