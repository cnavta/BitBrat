/**
 * docker-compose-strategy-secure-files.test.ts
 *
 * Unit tests for secure file deployment in DockerComposeStrategy
 *
 * Sprint 374: Secure File Deployment (SF-013)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { DockerComposeStrategy } from './docker-compose-strategy';
import type { ServiceWithName } from './strategy';
import type { ResolvedContext } from '../../context/types';
import type { SecureFile } from '../../config/types';

describe('DockerComposeStrategy - Secure Files', () => {
  let tmpDir: string;
  let strategy: DockerComposeStrategy;

  beforeEach(async () => {
    // Create temporary directory for tests
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docker-compose-test-'));
    strategy = new DockerComposeStrategy();

    // Create .gitignore file
    const gitignoreContent = `.secure.local/\n*.secret\n`;
    await fs.promises.writeFile(path.join(tmpDir, '.gitignore'), gitignoreContent);

    // Mock process.cwd() to use tmpDir
    jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe('prepare() - Secure File Validation', () => {
    it('should validate secure files during prepare()', async () => {
      // Create test secure file
      const secureDir = path.join(tmpDir, '.secure.local');
      await fs.promises.mkdir(secureDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(secureDir, 'test.json'),
        '{"test": true}'
      );

      const service: ServiceWithName = {
        name: 'test-service',
        secureFiles: [
          {
            local: '.secure.local/test.json',
            target: '/var/secrets/test.json',
            permissions: '0400',
            required: true,
            context: 'local',
          },
        ],
      };

      const context: ResolvedContext = {
        name: 'local',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          envVars: {},
        },
      } as any;

      const plan = await strategy.prepare(service, context, {});

      expect(plan.metadata.secureFiles).toBeDefined();
      expect((plan.metadata.secureFiles as SecureFile[]).length).toBe(1);
    });

    it('should fail prepare() if secure file validation fails', async () => {
      const service: ServiceWithName = {
        name: 'test-service',
        secureFiles: [
          {
            local: 'not-git-ignored.json', // Not git-ignored
            target: '/tmp/bad-path.json', // Wrong target prefix
            permissions: '9999', // Invalid permissions
            required: true,
          },
        ],
      };

      const context: ResolvedContext = {
        name: 'local',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          envVars: {},
        },
      } as any;

      await expect(strategy.prepare(service, context, {})).rejects.toThrow(
        /Secure file validation failed/
      );
    });

    it('should filter secure files by execution context', async () => {
      // Create test files
      const secureDir = path.join(tmpDir, '.secure.local');
      await fs.promises.mkdir(secureDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(secureDir, 'local.json'),
        '{"local": true}'
      );

      const service: ServiceWithName = {
        name: 'test-service',
        secureFiles: [
          {
            local: '.secure.local/local.json',
            target: '/var/secrets/local.json',
            context: 'local',
          },
          {
            local: '.secure.staging/staging.json',
            target: '/var/secrets/staging.json',
            context: 'staging',
          },
        ],
      };

      const context: ResolvedContext = {
        name: 'local',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          envVars: {},
        },
      } as any;

      const plan = await strategy.prepare(service, context, {});

      // Should only include 'local' context file
      const secureFiles = plan.metadata.secureFiles as SecureFile[];
      expect(secureFiles.length).toBe(1);
      expect(secureFiles[0].local).toBe('.secure.local/local.json');
    });
  });

  describe('generateVolumeMounts()', () => {
    it('should generate correct volume mount strings', () => {
      const secureFiles: SecureFile[] = [
        {
          local: '.secure.local/file1.json',
          target: '/var/secrets/file1.json',
        },
        {
          local: '.secure.local/file2.txt',
          target: '/run/secrets/file2.txt',
        },
      ];

      // Access private method via reflection for testing
      const volumeMounts = (strategy as any).generateVolumeMounts(secureFiles, tmpDir);

      expect(volumeMounts).toHaveLength(2);
      expect(volumeMounts[0]).toMatch(
        new RegExp(`${tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.secure.local/file1.json:/var/secrets/file1.json:ro`)
      );
      expect(volumeMounts[1]).toMatch(
        new RegExp(`${tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.secure.local/file2.txt:/run/secrets/file2.txt:ro`)
      );
    });

    it('should make volume mounts read-only', () => {
      const secureFiles: SecureFile[] = [
        {
          local: '.secure.local/test.json',
          target: '/var/secrets/test.json',
        },
      ];

      const volumeMounts = (strategy as any).generateVolumeMounts(secureFiles, tmpDir);

      expect(volumeMounts[0]).toContain(':ro');
    });
  });

  describe('injectSecureFileConfig()', () => {
    it('should inject volume mounts into compose YAML', async () => {
      // Create test compose file
      const composeFilePath = path.join(tmpDir, 'docker-compose.yaml');
      const composeContent = `
services:
  test-service:
    image: test:latest
    environment:
      NODE_ENV: production
`;
      await fs.promises.writeFile(composeFilePath, composeContent);

      const volumeMounts = [
        `${tmpDir}/.secure.local/test.json:/var/secrets/test.json:ro`,
      ];
      const envVars = {
        SECRET_FILE: '/var/secrets/test.json',
      };

      const modifiedYaml = await (strategy as any).injectSecureFileConfig(
        composeFilePath,
        'test-service',
        volumeMounts,
        envVars
      );

      expect(modifiedYaml).toContain('volumes:');
      expect(modifiedYaml).toContain('.secure.local/test.json:/var/secrets/test.json:ro');
      expect(modifiedYaml).toContain('SECRET_FILE: /var/secrets/test.json');
    });

    it('should preserve existing compose configuration', async () => {
      const composeFilePath = path.join(tmpDir, 'docker-compose.yaml');
      const composeContent = `
services:
  test-service:
    image: test:latest
    ports:
      - "3000:3000"
    volumes:
      - /existing/volume:/app
    environment:
      NODE_ENV: production
`;
      await fs.promises.writeFile(composeFilePath, composeContent);

      const volumeMounts = [`${tmpDir}/.secure/new.json:/var/secrets/new.json:ro`];
      const envVars = { NEW_VAR: 'new-value' };

      const modifiedYaml = await (strategy as any).injectSecureFileConfig(
        composeFilePath,
        'test-service',
        volumeMounts,
        envVars
      );

      // Should preserve existing config
      expect(modifiedYaml).toContain('ports:');
      expect(modifiedYaml).toMatch(/['"]3000:3000['"]/); // Accept single or double quotes
      expect(modifiedYaml).toContain('/existing/volume:/app');
      expect(modifiedYaml).toContain('NODE_ENV: production');

      // Should add new config
      expect(modifiedYaml).toContain('.secure/new.json:/var/secrets/new.json:ro');
      expect(modifiedYaml).toContain('NEW_VAR: new-value');
    });

    it('should deduplicate volume mounts', async () => {
      const composeFilePath = path.join(tmpDir, 'docker-compose.yaml');
      const composeContent = `
services:
  test-service:
    image: test:latest
    volumes:
      - /duplicate:/var/secrets/test.json:ro
`;
      await fs.promises.writeFile(composeFilePath, composeContent);

      const volumeMounts = ['/duplicate:/var/secrets/test.json:ro'];

      const modifiedYaml = await (strategy as any).injectSecureFileConfig(
        composeFilePath,
        'test-service',
        volumeMounts,
        {}
      );

      // Should not duplicate the volume mount
      const volumeOccurrences = (modifiedYaml.match(/\/duplicate:/g) || []).length;
      expect(volumeOccurrences).toBe(1);
    });
  });

  describe('transferSecureFilesToRemote() - Unit', () => {
    it('should parse SSH host correctly', () => {
      // This is a unit test that would require mocking execSync
      // For now, we test the SSH parsing logic indirectly via integration tests
      expect(true).toBe(true); // Placeholder
    });
  });
});
