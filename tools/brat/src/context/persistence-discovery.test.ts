/**
 * Sprint 349: Persistence Discovery Unit Tests
 */

import { execSync } from 'child_process';
import { discoverPostgresContainer } from './persistence-discovery';

// Mock child_process
jest.mock('child_process');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('Persistence Discovery - Sprint 349', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverPostgresContainer', () => {
    it('discovers postgres config from docker inspect output', async () => {
      const envVars = JSON.stringify([
        'PATH=/usr/local/bin:/usr/bin',
        'POSTGRES_USER=bitbrat',
        'POSTGRES_PASSWORD=secret123',
        'POSTGRES_DB=bitbrat',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toEqual({
        driver: 'postgres',
        connection: {
          host: 'postgres',
          port: 5432,
          database: 'bitbrat',
          username: 'bitbrat',
          password: 'secret123',
        },
      });
    });

    it('discovers postgres config from remote Docker (SSH)', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=staging_user',
        'POSTGRES_PASSWORD=staging_pass',
        'POSTGRES_DB=staging_db',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('ssh://root@bitbrat.lan');

      expect(config).toEqual({
        driver: 'postgres',
        connection: {
          host: 'postgres',
          port: 5432,
          database: 'staging_db',
          username: 'staging_user',
          password: 'staging_pass',
        },
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('ssh root@bitbrat.lan'),
        expect.any(Object)
      );
    });

    it('defaults database name to username if POSTGRES_DB not set', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=myuser',
        'POSTGRES_PASSWORD=mypass',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config?.connection?.database).toBe('myuser');
    });

    it('returns null when POSTGRES_USER missing', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_PASSWORD=secret',
        'POSTGRES_DB=db',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeNull();
    });

    it('returns null when POSTGRES_PASSWORD missing', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=user',
        'POSTGRES_DB=db',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeNull();
    });

    it('returns null when docker command fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Docker not running');
      });

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeNull();
    });

    it('returns null when no postgres container found (empty output)', async () => {
      mockExecSync.mockReturnValue('' as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeNull();
    });

    it('returns null when output is invalid JSON', async () => {
      mockExecSync.mockReturnValue('not valid json' as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeNull();
    });

    it('filters non-POSTGRES_ env vars', async () => {
      const envVars = JSON.stringify([
        'PATH=/usr/bin',
        'POSTGRES_USER=user',
        'POSTGRES_PASSWORD=pass',
        'POSTGRES_DB=db',
        'LANG=en_US.UTF-8',
        'HOME=/root',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toEqual({
        driver: 'postgres',
        connection: {
          host: 'postgres',
          port: 5432,
          database: 'db',
          username: 'user',
          password: 'pass',
        },
      });
    });

    it('uses correct docker commands for local host', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=user',
        'POSTGRES_PASSWORD=pass',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker ps --filter \'name=postgres\''),
        expect.any(Object)
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker inspect'),
        expect.any(Object)
      );
    });

    it('respects timeout (10 seconds)', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=user',
        'POSTGRES_PASSWORD=pass',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 10000 })
      );
    });
  });

  describe('edge cases', () => {
    it('handles env vars with = in value', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=user',
        'POSTGRES_PASSWORD=pass=with=equals',
        'POSTGRES_DB=db',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config?.connection?.password).toBe('pass=with=equals');
    });

    it('handles whitespace in JSON', async () => {
      const envVars = JSON.stringify([
        '  POSTGRES_USER=user  ',
        '  POSTGRES_PASSWORD=pass  ',
      ], null, 2);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config).toBeDefined();
      expect(config?.connection?.username).toBe('user  '); // Preserves whitespace in value
    });

    it('handles special characters in password', async () => {
      const envVars = JSON.stringify([
        'POSTGRES_USER=user',
        'POSTGRES_PASSWORD=p@$$w0rd!#$%',
        'POSTGRES_DB=db',
      ]);
      mockExecSync.mockReturnValue(envVars as any);

      const config = await discoverPostgresContainer('unix:///var/run/docker.sock');

      expect(config?.connection?.password).toBe('p@$$w0rd!#$%');
    });
  });
});
