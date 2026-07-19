/**
 * Sprint 349: ContextResolver Unit Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ContextResolver, ContextResolutionError } from './context-resolver';
import type { ExecutionContexts } from '../config/execution-context-schema';
import type { Architecture } from '../config/schema';
import type { BratrcConfig } from './types';

// Mock fs module
jest.mock('fs');
jest.mock('os');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe('ContextResolver - Sprint 349', () => {
  let resolver: ContextResolver;
  const repoRoot = '/fake/repo';
  const archPath = '/fake/repo/architecture.yaml';
  const bratrcPath = '/fake/home/.bratrc';

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new ContextResolver(repoRoot);
    mockOs.homedir.mockReturnValue('/fake/home');

    // Default: no ~/.bratrc
    mockFs.existsSync.mockImplementation((p) => {
      if (p === archPath) return true;
      return false;
    });
  });

  describe('resolveContextName priority', () => {
    const validArch: Architecture = {
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
          deployment: { type: 'docker-compose', docker: { host: 'ssh://root@staging' } },
          runtime: {
            gateway: { url: 'http://staging:3000' },
            persistence: { driver: 'firestore' },
          },
        },
      },
    };

    beforeEach(() => {
      mockFs.readFileSync.mockImplementation((p) => {
        if (p === archPath) return yaml.dump(validArch);
        throw new Error('File not found');
      });
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);
    });

    it('uses explicit --context flag (priority 1)', async () => {
      process.env.BITBRAT_CONTEXT = 'staging';
      mockFs.existsSync.mockImplementation((p) => {
        if (p === archPath) return true;
        if (p === bratrcPath) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p) => {
        if (p === archPath) return yaml.dump(validArch);
        if (p === bratrcPath) return yaml.dump({ current_context: 'local' });
        throw new Error('File not found');
      });

      const result = await resolver.resolve('staging');
      expect(result.name).toBe('staging');

      delete process.env.BITBRAT_CONTEXT;
    });

    it('uses BITBRAT_CONTEXT env var (priority 2)', async () => {
      process.env.BITBRAT_CONTEXT = 'staging';

      const result = await resolver.resolve();
      expect(result.name).toBe('staging');

      delete process.env.BITBRAT_CONTEXT;
    });

    it('uses ~/.bratrc current_context (priority 3)', async () => {
      mockFs.existsSync.mockImplementation((p) => {
        if (p === archPath) return true;
        if (p === bratrcPath) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p) => {
        if (p === archPath) return yaml.dump(validArch);
        if (p === bratrcPath) return yaml.dump({ current_context: 'staging' });
        throw new Error('File not found');
      });

      const result = await resolver.resolve();
      expect(result.name).toBe('staging');
    });

    it('defaults to local (priority 4)', async () => {
      const result = await resolver.resolve();
      expect(result.name).toBe('local');
    });

    it('handles missing ~/.bratrc gracefully', async () => {
      mockFs.existsSync.mockImplementation((p) => {
        if (p === archPath) return true;
        return false; // no bratrc
      });

      const result = await resolver.resolve();
      expect(result.name).toBe('local');
    });

    it('handles invalid ~/.bratrc gracefully', async () => {
      mockFs.existsSync.mockImplementation((p) => {
        if (p === archPath) return true;
        if (p === bratrcPath) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p) => {
        if (p === archPath) return yaml.dump(validArch);
        if (p === bratrcPath) return 'invalid: yaml: [[[';
        throw new Error('File not found');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = await resolver.resolve();
      expect(result.name).toBe('local');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse ~/.bratrc'));
      consoleSpy.mockRestore();
    });
  });

  describe('loadExecutionContexts', () => {
    it('loads contexts from architecture.yaml', async () => {
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
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');
      expect(result.name).toBe('local');
      expect(result.deployment.type).toBe('docker-compose');
    });

    it('throws error when architecture.yaml not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(resolver.resolve('local')).rejects.toThrow(ContextResolutionError);
      await expect(resolver.resolve('local')).rejects.toThrow('architecture.yaml not found');
    });

    it('throws error when executionContexts is missing', async () => {
      const arch: Architecture = {
        services: {},
        // No executionContexts
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('local')).rejects.toThrow(ContextResolutionError);
      await expect(resolver.resolve('local')).rejects.toThrow('No execution contexts defined');
    });

    it('throws error when executionContexts is empty', async () => {
      const arch: Architecture = {
        services: {},
        executionContexts: {},
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('local')).rejects.toThrow('No execution contexts defined');
    });

    it('throws error when requested context not found', async () => {
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
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('nonexistent')).rejects.toThrow(ContextResolutionError);
      await expect(resolver.resolve('nonexistent')).rejects.toThrow('Unknown execution context: \'nonexistent\'');
      await expect(resolver.resolve('nonexistent')).rejects.toThrow('Available contexts: local');
    });
  });

  describe('caching', () => {
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

    beforeEach(() => {
      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);
    });

    it('caches resolved contexts', async () => {
      await resolver.resolve('local');
      await resolver.resolve('local');

      // readFileSync should only be called once (cached on second call)
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache when architecture.yaml modified', async () => {
      // First call: initial load (statSync called twice: once for load, once for mtime save)
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);
      await resolver.resolve('local');

      // Simulate file modification (different mtime)
      mockFs.statSync.mockReturnValue({ mtimeMs: 789012 } as fs.Stats);
      await resolver.resolve('local');

      // readFileSync should be called twice (cache invalidated due to mtime change)
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
    });

    it('clearCache() clears all caches', async () => {
      await resolver.resolve('local');
      resolver.clearCache();
      await resolver.resolve('local');

      // readFileSync should be called twice (cache cleared)
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('gateway resolution (basic)', () => {
    it('resolves explicit gateway URL', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@staging' } },
            runtime: {
              gateway: {
                url: 'http://staging.local:3002',
                authToken: '${MCP_AUTH_TOKEN}',
              },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('staging');
      expect(result.runtime.gateway.url).toBe('http://staging.local:3002');
      expect(result.runtime.gateway.authToken).toBe('${MCP_AUTH_TOKEN}');
    });

    it('resolves fallbackPort', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          local: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              gateway: { fallbackPort: 3004 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');
      expect(result.runtime.gateway.url).toBe('ws://localhost:3004/ws/v1');
    });

    it('resolves fallbackPort with SSH host', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@bitbrat.lan' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('staging');
      expect(result.runtime.gateway.url).toBe('ws://bitbrat.lan:3000/ws/v1');
    });

    it('throws error when no gateway resolution method available', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          broken: {
            deployment: { type: 'docker-compose', docker: { host: 'unix:///var/run/docker.sock' } },
            runtime: {
              // No gateway config at all
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('broken')).rejects.toThrow(ContextResolutionError);
      await expect(resolver.resolve('broken')).rejects.toThrow('Cannot resolve gateway URL');
    });
  });

  describe('persistence resolution (basic)', () => {
    it('resolves postgres with explicit connection', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@staging' } },
            runtime: {
              gateway: { url: 'http://staging:3000' },
              persistence: {
                driver: 'postgres',
                connection: {
                  host: 'staging.local',
                  port: 5432,
                  database: 'bitbrat',
                  username: 'bitbrat',
                  password: 'secret',
                },
              },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('staging');
      expect(result.runtime.persistence.driver).toBe('postgres');
      expect(result.runtime.persistence.connection?.host).toBe('staging.local');
      expect(result.runtime.persistence.connection?.port).toBe(5432);
    });

    it('resolves firestore', async () => {
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
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');
      expect(result.runtime.persistence.driver).toBe('firestore');
      expect(result.runtime.persistence.connection).toBeUndefined();
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
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      await expect(resolver.resolve('broken')).rejects.toThrow(ContextResolutionError);
      await expect(resolver.resolve('broken')).rejects.toThrow('Cannot resolve PostgreSQL persistence');
    });
  });

  describe('utility methods', () => {
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
          deployment: { type: 'docker-compose', docker: { host: 'ssh://root@staging' } },
          runtime: {
            gateway: { url: 'http://staging:3000' },
            persistence: { driver: 'firestore' },
          },
        },
      },
    };

    beforeEach(() => {
      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);
    });

    it('listContexts() returns all context names', async () => {
      const contexts = await resolver.listContexts();
      expect(contexts).toEqual(['local', 'staging']);
    });

    it('contextExists() returns true for existing context', async () => {
      const exists = await resolver.contextExists('local');
      expect(exists).toBe(true);
    });

    it('contextExists() returns false for non-existing context', async () => {
      const exists = await resolver.contextExists('nonexistent');
      expect(exists).toBe(false);
    });

    it('getRawContext() returns unresolved context', async () => {
      const raw = await resolver.getRawContext('staging');
      expect(raw).toBeDefined();
      expect(raw?.deployment.type).toBe('docker-compose');
      expect(raw?.runtime.gateway?.url).toBe('http://staging:3000');
    });

    it('getRawContext() returns undefined for non-existing context', async () => {
      const raw = await resolver.getRawContext('nonexistent');
      expect(raw).toBeUndefined();
    });
  });

  describe('extractHost', () => {
    it('extracts localhost from unix socket', async () => {
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
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('local');
      expect(result.runtime.gateway.url).toContain('localhost');
    });

    it('extracts host from SSH URL', async () => {
      const arch: Architecture = {
      services: {},
        executionContexts: {
          staging: {
            deployment: { type: 'docker-compose', docker: { host: 'ssh://root@bitbrat.lan' } },
            runtime: {
              gateway: { fallbackPort: 3000 },
              persistence: { driver: 'firestore' },
            },
          },
        },
      };

      mockFs.readFileSync.mockReturnValue(yaml.dump(arch));
      mockFs.statSync.mockReturnValue({ mtimeMs: 123456 } as fs.Stats);

      const result = await resolver.resolve('staging');
      expect(result.runtime.gateway.url).toContain('bitbrat.lan');
    });
  });
});
