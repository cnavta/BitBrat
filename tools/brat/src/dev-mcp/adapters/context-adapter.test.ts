/**
 * Context Adapter Tests
 *
 * Unit tests for ContextAdapter class.
 */

import { ContextAdapter } from './context-adapter';
import type { ResolvedContext } from '../../context/types';
import { createLogger } from '../../orchestration/logger';

describe('ContextAdapter', () => {
  let adapter: ContextAdapter;
  const logger = createLogger({ base: { component: 'test' }, level: 'silent' });

  beforeEach(() => {
    adapter = new ContextAdapter(logger);
  });

  describe('createConnection()', () => {
    it('should create connection for local PostgreSQL context', async () => {
      const resolved: ResolvedContext = {
        name: 'local',
        description: 'Local development',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          gateway: {
            url: 'ws://localhost:3004/ws/v1',
            authToken: 'test-token',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'bitbrat_dev_password',
            },
          },
          envVars: {},
        },
        tags: ['development', 'local'],
      };

      const connection = await adapter.createConnection(resolved);

      expect(connection.name).toBe('local');
      expect(connection.type).toBe('local');
      expect(connection.persistenceDriver).toBe('postgres');
      expect(connection.gateway?.url).toBe('ws://localhost:3004/ws/v1');
      expect(connection.gateway?.authToken).toBe('test-token');
      expect(connection.store).toBeDefined();
      expect(connection.ssh).toBeUndefined();

      // Cleanup
      await connection.cleanup();
    });

    it('should create connection for remote SSH context', async () => {
      const resolved: ResolvedContext = {
        name: 'staging',
        description: 'Remote staging',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://root@bitbrat.lan',
            remoteDir: '/opt/BitBratPlatform',
          },
        },
        runtime: {
          gateway: {
            url: 'ws://bitbrat.lan:3004/ws/v1',
            authToken: 'staging-token',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'bitbrat.lan',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'bitbrat_dev_password',
            },
          },
          envVars: {},
        },
      };

      const connection = await adapter.createConnection(resolved);

      expect(connection.name).toBe('staging');
      expect(connection.type).toBe('remote-ssh'); // docker-compose with ssh:// host maps to remote-ssh
      expect(connection.ssh).toBeDefined();
      expect(connection.ssh?.target).toBe('root@bitbrat.lan');
      expect(connection.ssh?.remoteDir).toBe('/opt/BitBratPlatform');
      expect(connection.loki).toBeDefined(); // SSH deployments get default Loki tunnel

      // Cleanup
      await connection.cleanup();
    });

    it('should create connection for GCP Cloud Run context', async () => {
      const resolved: ResolvedContext = {
        name: 'prod',
        description: 'Production GCP',
        deployment: {
          type: 'cloud-run',
          gcp: {
            project: 'bitbrat-prod',
            region: 'us-central1',
          },
        },
        runtime: {
          gateway: {
            url: 'wss://bitbrat-prod.run.app/ws/v1',
            authToken: 'prod-token',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: '/cloudsql/bitbrat-prod:us-central1:bitbrat-db',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'prod-password',
            },
          },
          envVars: {},
        },
      };

      const connection = await adapter.createConnection(resolved);

      expect(connection.name).toBe('prod');
      expect(connection.type).toBe('gcp');
      expect(connection.ssh).toBeUndefined();

      // Cleanup
      await connection.cleanup();
    });

    it('should extract Loki URL from env vars', async () => {
      const resolved: ResolvedContext = {
        name: 'test',
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          gateway: { url: 'ws://localhost:3004/ws/v1' },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envVars: {
            LOKI_URL: 'http://localhost:3100',
          },
        },
      };

      const connection = await adapter.createConnection(resolved);

      expect(connection.loki).toBeDefined();
      expect(connection.loki?.url).toBe('http://localhost:3100');

      // Cleanup
      await connection.cleanup();
    });

    it('should extract Loki tunnel config from env vars', async () => {
      const resolved: ResolvedContext = {
        name: 'test',
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          gateway: { url: 'ws://localhost:3004/ws/v1' },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envVars: {
            LOKI_TUNNEL_LOCAL_PORT: '3100',
            LOKI_TUNNEL_REMOTE_PORT: '3100',
          },
        },
      };

      const connection = await adapter.createConnection(resolved);

      expect(connection.loki).toBeDefined();
      expect(connection.loki?.tunnel).toBeDefined();
      expect(connection.loki?.tunnel?.localPort).toBe(3100);
      expect(connection.loki?.tunnel?.remotePort).toBe(3100);

      // Cleanup
      await connection.cleanup();
    });

    it('should throw error when PostgreSQL connection config is missing', async () => {
      const resolved: ResolvedContext = {
        name: 'invalid',
        deployment: {
          type: 'docker-compose',
        },
        runtime: {
          gateway: { url: 'ws://localhost:3004/ws/v1' },
          persistence: {
            driver: 'postgres',
            // Missing connection config
          },
          envVars: {},
        },
      };

      await expect(adapter.createConnection(resolved)).rejects.toThrow(
        /PostgreSQL connection config missing/
      );
    });

    it('should handle cleanup gracefully', async () => {
      const resolved: ResolvedContext = {
        name: 'cleanup-test',
        deployment: {
          type: 'docker-compose',
          docker: { host: 'unix:///var/run/docker.sock' },
        },
        runtime: {
          gateway: { url: 'ws://localhost:3004/ws/v1' },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envVars: {},
        },
      };

      const connection = await adapter.createConnection(resolved);

      // Should not throw
      await expect(connection.cleanup()).resolves.not.toThrow();
    });
  });

  describe('deployment type mapping', () => {
    it('should map docker-compose to local', async () => {
      const resolved: ResolvedContext = {
        name: 'test',
        deployment: { type: 'docker-compose' },
        runtime: {
          gateway: { url: 'ws://localhost:3004/ws/v1' },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'localhost',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envVars: {},
        },
      };

      const connection = await adapter.createConnection(resolved);
      expect(connection.type).toBe('local');

      await connection.cleanup();
    });

    it('should map cloud-run to gcp', async () => {
      const resolved: ResolvedContext = {
        name: 'test',
        deployment: { type: 'cloud-run' },
        runtime: {
          gateway: { url: 'wss://test.run.app/ws/v1' },
          persistence: {
            driver: 'postgres',
            connection: {
              host: '/cloudsql/test:us-central1:db',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envVars: {},
        },
      };

      const connection = await adapter.createConnection(resolved);
      expect(connection.type).toBe('gcp');

      await connection.cleanup();
    });
  });
});
