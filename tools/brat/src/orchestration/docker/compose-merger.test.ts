/**
 * Tests for ComposeMerger
 *
 * @module orchestration/docker/compose-merger.test
 * @since Sprint 375
 */

import { ComposeMerger } from './compose-merger';
import type { SecureFile } from '../../config/types';

describe('ComposeMerger', () => {
  let merger: ComposeMerger;

  beforeEach(() => {
    merger = new ComposeMerger();
  });

  describe('merge()', () => {
    describe('Volume Array Merging', () => {
      it('should merge volume arrays without duplicates', () => {
        const baseYaml = `
services:
  test-service:
    image: test:latest
    volumes:
      - vol1:/data1
      - vol2:/data2
`;

        const serviceYaml = `
services:
  test-service:
    volumes:
      - vol3:/data3
      - vol1:/data1  # Duplicate
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].volumes).toEqual([
          'vol1:/data1',
          'vol2:/data2',
          'vol3:/data3',
        ]);
        expect(result.stats.volumesAdded).toBe(1); // Only vol3 added (vol1 is duplicate)
      });

      it('should append service volumes to base volumes', () => {
        const baseYaml = `
services:
  test-service:
    image: test:latest
    volumes:
      - /host/path1:/container/path1
`;

        const serviceYaml = `
services:
  test-service:
    volumes:
      - /host/path2:/container/path2:ro
      - /host/path3:/container/path3
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].volumes).toHaveLength(3);
        expect(result.parsed.services['test-service'].volumes).toContain('/host/path2:/container/path2:ro');
        expect(result.stats.volumesAdded).toBe(2);
      });

      it('should handle base service with no volumes', () => {
        const baseYaml = `
services:
  test-service:
    image: test:latest
`;

        const serviceYaml = `
services:
  test-service:
    volumes:
      - vol1:/data1
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].volumes).toEqual(['vol1:/data1']);
        expect(result.stats.volumesAdded).toBe(1);
      });
    });

    describe('Environment Variable Merging', () => {
      it('should merge environment objects with service precedence', () => {
        const baseYaml = `
services:
  test-service:
    environment:
      BASE_VAR: "base_value"
      SHARED_VAR: "base_shared"
`;

        const serviceYaml = `
services:
  test-service:
    environment:
      SERVICE_VAR: "service_value"
      SHARED_VAR: "service_shared"  # Override
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const env = result.parsed.services['test-service'].environment as Record<string, string>;
        expect(env['BASE_VAR']).toBe('base_value');
        expect(env['SERVICE_VAR']).toBe('service_value');
        expect(env['SHARED_VAR']).toBe('service_shared'); // Service wins
        expect(result.stats.environmentAdded).toBe(2);
      });

      it('should merge environment arrays', () => {
        const baseYaml = `
services:
  test-service:
    environment:
      - BASE_VAR=base_value
      - SHARED_VAR=base_shared
`;

        const serviceYaml = `
services:
  test-service:
    environment:
      - SERVICE_VAR=service_value
      - SHARED_VAR=base_shared  # Duplicate
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const env = result.parsed.services['test-service'].environment as string[];
        expect(env).toHaveLength(3);
        expect(env).toContain('BASE_VAR=base_value');
        expect(env).toContain('SERVICE_VAR=service_value');
        expect(env).toContain('SHARED_VAR=base_shared');
      });

      it('should handle mixed environment types (fallback to override)', () => {
        const baseYaml = `
services:
  test-service:
    environment:
      - BASE_VAR=base_value
`;

        const serviceYaml = `
services:
  test-service:
    environment:
      SERVICE_VAR: "service_value"
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        // When types mismatch, service override wins
        const env = result.parsed.services['test-service'].environment as Record<string, string>;
        expect(env['SERVICE_VAR']).toBe('service_value');
      });
    });

    describe('depends_on Merging', () => {
      it('should merge depends_on objects', () => {
        const baseYaml = `
services:
  test-service:
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_healthy
`;

        const serviceYaml = `
services:
  test-service:
    depends_on:
      tool-gateway:
        condition: service_healthy
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const deps = result.parsed.services['test-service'].depends_on as Record<string, { condition?: string }>;
        expect(Object.keys(deps)).toHaveLength(3);
        expect(deps['postgres']).toEqual({ condition: 'service_healthy' });
        expect(deps['tool-gateway']).toEqual({ condition: 'service_healthy' });
        expect(result.stats.dependenciesAdded).toBe(1);
      });

      it('should merge depends_on arrays', () => {
        const baseYaml = `
services:
  test-service:
    depends_on:
      - postgres
      - nats
`;

        const serviceYaml = `
services:
  test-service:
    depends_on:
      - tool-gateway
      - postgres  # Duplicate
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const deps = result.parsed.services['test-service'].depends_on as string[];
        expect(deps).toHaveLength(3);
        expect(deps).toContain('postgres');
        expect(deps).toContain('nats');
        expect(deps).toContain('tool-gateway');
      });
    });

    describe('networks Merging', () => {
      it('should merge network aliases', () => {
        const baseYaml = `
services:
  test-service:
    networks:
      bitbrat-network:
        aliases:
          - service.base.local
`;

        const serviceYaml = `
services:
  test-service:
    networks:
      bitbrat-network:
        aliases:
          - service.override.local
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const networks = result.parsed.services['test-service'].networks as Record<string, { aliases: string[] }>;
        expect(networks['bitbrat-network'].aliases).toHaveLength(2);
        expect(networks['bitbrat-network'].aliases).toContain('service.base.local');
        expect(networks['bitbrat-network'].aliases).toContain('service.override.local');
      });

      it('should add new networks from service override', () => {
        const baseYaml = `
services:
  test-service:
    networks:
      network1: {}
`;

        const serviceYaml = `
services:
  test-service:
    networks:
      network2:
        aliases:
          - service.network2.local
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        const networks = result.parsed.services['test-service'].networks as Record<string, unknown>;
        expect(Object.keys(networks)).toHaveLength(2);
        expect(networks['network1']).toBeDefined();
        expect(networks['network2']).toBeDefined();
      });
    });

    describe('Simple Field Overrides', () => {
      it('should override build configuration', () => {
        const baseYaml = `
services:
  test-service:
    build:
      context: .
      dockerfile: Dockerfile
`;

        const serviceYaml = `
services:
  test-service:
    build:
      context: .
      dockerfile: Dockerfile.custom
      args:
        SERVICE_NAME: test
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].build).toEqual({
          context: '.',
          dockerfile: 'Dockerfile.custom',
          args: { SERVICE_NAME: 'test' },
        });
      });

      it('should override ports', () => {
        const baseYaml = `
services:
  test-service:
    ports:
      - "3000:3000"
`;

        const serviceYaml = `
services:
  test-service:
    ports:
      - "8080:3000"
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].ports).toEqual(['8080:3000']);
      });

      it('should override image', () => {
        const baseYaml = `
services:
  test-service:
    image: base:latest
`;

        const serviceYaml = `
services:
  test-service:
    image: override:v1.0.0
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        expect(result.parsed.services['test-service'].image).toBe('override:v1.0.0');
      });
    });

    describe('Edge Cases', () => {
      it('should throw error on invalid base YAML in strict mode', () => {
        const invalidYaml = 'invalid: [unclosed';
        const validYaml = 'services:\n  test: {}';

        expect(() => {
          merger.merge(invalidYaml, validYaml, { serviceName: 'test' });
        }).toThrow('Failed to parse base compose YAML');
      });

      it('should throw error on invalid service YAML in strict mode', () => {
        const validYaml = 'services:\n  test: {}';
        const invalidYaml = 'invalid: [unclosed';

        expect(() => {
          merger.merge(validYaml, invalidYaml, { serviceName: 'test' });
        }).toThrow('Failed to parse service compose YAML');
      });

      it('should throw error when service missing from base (strict mode)', () => {
        const baseYaml = `
services:
  other-service:
    image: test:latest
`;

        const serviceYaml = `
services:
  test-service:
    image: test:latest
`;

        expect(() => {
          merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service', validationMode: 'strict' });
        }).toThrow("Service 'test-service' not found in base compose file");
      });

      it('should add service when missing from base (lenient mode)', () => {
        const baseYaml = `
services:
  other-service:
    image: test:latest
`;

        const serviceYaml = `
services:
  test-service:
    image: test:latest
`;

        const result = merger.merge(baseYaml, serviceYaml, {
          serviceName: 'test-service',
          validationMode: 'lenient',
        });

        // Sprint 378: In lenient mode, if service doesn't exist in base, ADD it from override
        expect(result.yaml).toContain('test-service');
        expect(result.yaml).toContain('other-service');
        expect(result.parsed.services['test-service']).toBeDefined();
        expect(result.parsed.services['test-service'].image).toBe('test:latest');
      });

      it('should return base unchanged when service missing from override (lenient mode)', () => {
        const baseYaml = `
services:
  test-service:
    image: test:latest
`;

        const serviceYaml = `
services:
  other-service:
    image: test:latest
`;

        const result = merger.merge(baseYaml, serviceYaml, {
          serviceName: 'test-service',
          validationMode: 'lenient',
        });

        expect(result.yaml).toBe(baseYaml);
        expect(result.stats.volumesAdded).toBe(0);
      });

      it('should handle empty service overrides', () => {
        const baseYaml = `
services:
  test-service:
    image: test:latest
    volumes:
      - vol1:/data1
`;

        const serviceYaml = `
services:
  test-service: {}
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'test-service' });

        // Empty override should not change base
        expect(result.parsed.services['test-service'].image).toBe('test:latest');
        expect(result.parsed.services['test-service'].volumes).toEqual(['vol1:/data1']);
      });
    });

    describe('Real-World Scenario: image-gen-mcp', () => {
      it('should merge image-gen-mcp service compose file correctly', () => {
        const baseYaml = `
version: "3.8"
services:
  image-gen-mcp:
    build:
      context: ../..
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: image-gen-mcp
        SERVICE_ENTRY: dist/services/image-gen-mcp/index.js
        SERVICE_PORT: "3000"
    environment:
      MCP_TRANSPORT: "\${MCP_TRANSPORT}"
      GCS_BUCKET_NAME: "\${GCS_BUCKET_NAME}"
    ports:
      - "\${IMAGE_GEN_MCP_HOST_PORT:-3016}:\${SERVICE_PORT:-3000}"
    depends_on:
      nats:
        condition: service_healthy
`;

        const serviceYaml = `
services:
  image-gen-mcp:
    env_file:
      - .env.brat
    environment:
      - NODE_ENV=local
      - BITBRAT_ENV=local
      - PORT=\${SERVICE_PORT:-8080}
    volumes:
      - bitbrat-storage:/var/bitbrat/storage
    depends_on:
      postgres:
        condition: service_healthy
      tool-gateway:
        condition: service_healthy
    networks:
      bitbrat-network:
        aliases:
          - image-gen-mcp.bitbrat.local
`;

        const result = merger.merge(baseYaml, serviceYaml, { serviceName: 'image-gen-mcp' });

        const service = result.parsed.services['image-gen-mcp'];

        // Volumes added
        expect(service.volumes).toContain('bitbrat-storage:/var/bitbrat/storage');

        // Environment merged (type mismatch: service array wins over base object)
        const env = service.environment as string[];
        expect(Array.isArray(env)).toBe(true);
        expect(env).toContain('NODE_ENV=local');
        expect(env).toContain('BITBRAT_ENV=local');
        expect(env).toContain('PORT=${SERVICE_PORT:-8080}');

        // depends_on merged
        const deps = service.depends_on as Record<string, { condition?: string }>;
        expect(deps['nats']).toBeDefined();
        expect(deps['postgres']).toBeDefined();
        expect(deps['tool-gateway']).toBeDefined();

        // Networks added
        expect(service.networks).toBeDefined();
        const networks = service.networks as Record<string, { aliases?: string[] }>;
        expect(networks['bitbrat-network']).toBeDefined();
        expect(networks['bitbrat-network'].aliases).toContain('image-gen-mcp.bitbrat.local');
      });
    });
  });

  describe('injectSecureFiles()', () => {
    it('should inject volume mounts for secureFiles', () => {
      const composeYaml = `
services:
  test-service:
    image: test:latest
    volumes:
      - existing-vol:/data
`;

      const volumeMounts = [
        '/opt/secrets/gcp.json:/var/secrets/gcp.json:ro',
        '/opt/secrets/api-key.txt:/var/secrets/api-key.txt:ro',
      ];

      const result = merger.injectSecureFiles(composeYaml, 'test-service', volumeMounts, {});

      const parsed = require('js-yaml').load(result);
      expect(parsed.services['test-service'].volumes).toHaveLength(3);
      expect(parsed.services['test-service'].volumes).toContain('/opt/secrets/gcp.json:/var/secrets/gcp.json:ro');
      expect(parsed.services['test-service'].volumes).toContain('/opt/secrets/api-key.txt:/var/secrets/api-key.txt:ro');
    });

    it('should inject environment variables for secureFiles', () => {
      const composeYaml = `
services:
  test-service:
    image: test:latest
    environment:
      EXISTING_VAR: "existing_value"
`;

      const envVars = {
        GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json',
        API_KEY_FILE: '/var/secrets/api-key.txt',
      };

      const result = merger.injectSecureFiles(composeYaml, 'test-service', [], envVars);

      const parsed = require('js-yaml').load(result);
      const env = parsed.services['test-service'].environment as Record<string, string>;
      expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/var/secrets/gcp.json');
      expect(env['API_KEY_FILE']).toBe('/var/secrets/api-key.txt');
      expect(env['EXISTING_VAR']).toBe('existing_value');
    });

    it('should inject both volumes and environment variables', () => {
      const composeYaml = `
services:
  test-service:
    image: test:latest
`;

      const volumeMounts = ['/opt/secrets/gcp.json:/var/secrets/gcp.json:ro'];
      const envVars = { GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json' };

      const result = merger.injectSecureFiles(composeYaml, 'test-service', volumeMounts, envVars);

      const parsed = require('js-yaml').load(result);
      expect(parsed.services['test-service'].volumes).toContain('/opt/secrets/gcp.json:/var/secrets/gcp.json:ro');
      expect(parsed.services['test-service'].environment['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/var/secrets/gcp.json');
    });

    it('should handle environment array format', () => {
      const composeYaml = `
services:
  test-service:
    environment:
      - EXISTING_VAR=existing_value
`;

      const envVars = { GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json' };

      const result = merger.injectSecureFiles(composeYaml, 'test-service', [], envVars);

      const parsed = require('js-yaml').load(result);
      const env = parsed.services['test-service'].environment as string[];
      expect(env).toContain('EXISTING_VAR=existing_value');
      expect(env).toContain('GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp.json');
    });

    it('should throw error when service not found', () => {
      const composeYaml = `
services:
  other-service:
    image: test:latest
`;

      expect(() => {
        merger.injectSecureFiles(composeYaml, 'test-service', [], {});
      }).toThrow("Service 'test-service' not found in compose file");
    });

    it('should deduplicate volume mounts', () => {
      const composeYaml = `
services:
  test-service:
    volumes:
      - /opt/secrets/gcp.json:/var/secrets/gcp.json:ro
`;

      const volumeMounts = [
        '/opt/secrets/gcp.json:/var/secrets/gcp.json:ro', // Duplicate
        '/opt/secrets/api-key.txt:/var/secrets/api-key.txt:ro',
      ];

      const result = merger.injectSecureFiles(composeYaml, 'test-service', volumeMounts, {});

      const parsed = require('js-yaml').load(result);
      expect(parsed.services['test-service'].volumes).toHaveLength(2);
    });
  });

  describe('Static Helpers', () => {
    describe('generateVolumeMounts()', () => {
      it('should generate volume mount strings from secureFiles', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/gcp-credentials.json',
            target: '/var/secrets/gcp-credentials.json',
            env: 'GOOGLE_APPLICATION_CREDENTIALS',
            permissions: '0400',
            required: true,
          },
          {
            local: '.secure.staging/api-key.txt',
            target: '/var/secrets/api-key.txt',
            required: true,
          },
        ];

        const mounts = ComposeMerger.generateVolumeMounts(secureFiles);

        expect(mounts).toHaveLength(2);
        expect(mounts[0]).toBe('.secure.staging/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro');
        expect(mounts[1]).toBe('.secure.staging/api-key.txt:/var/secrets/api-key.txt:ro');
      });

      it('should add local prefix when provided', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/gcp-credentials.json',
            target: '/var/secrets/gcp-credentials.json',
            required: true,
          },
        ];

        const mounts = ComposeMerger.generateVolumeMounts(secureFiles, '/opt/BitBratPlatform');

        expect(mounts[0]).toBe('/opt/BitBratPlatform/.secure.staging/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro');
      });

      it('should always use read-only mode for security', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/gcp-credentials.json',
            target: '/var/secrets/gcp-credentials.json',
            required: true,
          },
        ];

        const mounts = ComposeMerger.generateVolumeMounts(secureFiles);

        expect(mounts[0]).toMatch(/:ro$/);
      });
    });

    describe('extractEnvVars()', () => {
      it('should extract environment variables from secureFiles', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/gcp-credentials.json',
            target: '/var/secrets/gcp-credentials.json',
            env: 'GOOGLE_APPLICATION_CREDENTIALS',
            required: true,
          },
          {
            local: '.secure.staging/api-key.txt',
            target: '/var/secrets/api-key.txt',
            env: 'API_KEY_FILE',
            required: true,
          },
        ];

        const envVars = ComposeMerger.extractEnvVars(secureFiles);

        expect(envVars['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/var/secrets/gcp-credentials.json');
        expect(envVars['API_KEY_FILE']).toBe('/var/secrets/api-key.txt');
      });

      it('should skip secureFiles without env property', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/gcp-credentials.json',
            target: '/var/secrets/gcp-credentials.json',
            env: 'GOOGLE_APPLICATION_CREDENTIALS',
            required: true,
          },
          {
            local: '.secure.staging/api-key.txt',
            target: '/var/secrets/api-key.txt',
            // No env property
            required: true,
          },
        ];

        const envVars = ComposeMerger.extractEnvVars(secureFiles);

        expect(Object.keys(envVars)).toHaveLength(1);
        expect(envVars['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/var/secrets/gcp-credentials.json');
      });

      it('should return empty object when no env vars defined', () => {
        const secureFiles: SecureFile[] = [
          {
            local: '.secure.staging/cert.pem',
            target: '/var/secrets/cert.pem',
            required: true,
          },
        ];

        const envVars = ComposeMerger.extractEnvVars(secureFiles);

        expect(Object.keys(envVars)).toHaveLength(0);
      });
    });
  });

  describe('Performance', () => {
    it('should merge typical compose files in <100ms', () => {
      const baseYaml = `
version: "3.8"
services:
  service1:
    image: test:latest
    volumes:
      - vol1:/data1
      - vol2:/data2
    environment:
      VAR1: "value1"
      VAR2: "value2"
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_healthy
`;

      const serviceYaml = `
services:
  service1:
    volumes:
      - vol3:/data3
      - vol4:/data4
    environment:
      VAR3: "value3"
      VAR4: "value4"
    depends_on:
      tool-gateway:
        condition: service_healthy
`;

      const start = Date.now();
      merger.merge(baseYaml, serviceYaml, { serviceName: 'service1' });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should inject secureFiles in <50ms', () => {
      const composeYaml = `
services:
  test-service:
    image: test:latest
    volumes:
      - vol1:/data1
`;

      const volumeMounts = [
        '/opt/secrets/file1.json:/var/secrets/file1.json:ro',
        '/opt/secrets/file2.json:/var/secrets/file2.json:ro',
      ];
      const envVars = {
        FILE1_PATH: '/var/secrets/file1.json',
        FILE2_PATH: '/var/secrets/file2.json',
      };

      const start = Date.now();
      merger.injectSecureFiles(composeYaml, 'test-service', volumeMounts, envVars);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50);
    });
  });
});
