/**
 * Unit tests for Cloud Run deployment strategy
 *
 * @module orchestration/deployment/cloud-run-strategy.test
 * @since Sprint 372
 */

import { CloudRunStrategy } from './cloud-run-strategy';
import type { ServiceWithName } from './strategy';
import type { ResolvedContext } from '../../context/types';
import * as fs from 'fs';

// Mock modules
jest.mock('fs');
jest.mock('../../providers/gcp/cloudbuild');
jest.mock('../../providers/gcp/preflight');
jest.mock('../../util/git');
jest.mock('../../config/loader');
jest.mock('../../providers/gcp/secrets');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('CloudRunStrategy', () => {
  let strategy: CloudRunStrategy;
  let mockService: ServiceWithName;
  let mockContext: ResolvedContext;

  beforeEach(() => {
    strategy = new CloudRunStrategy();
    jest.clearAllMocks();

    mockService = {
      name: 'test-service',
      active: true,
      entry: 'dist/apps/test-service.js',
      port: 3000,
      region: 'us-central1',
      cpu: '1',
      memory: '512Mi',
      scaling: { min: 1, max: 10 },
      secrets: ['API_KEY', 'DATABASE_PASSWORD'],
    };

    mockContext = {
      name: 'staging',
      deployment: {
        type: 'cloud-run',
        gcp: {
          project: 'test-project-123',
          region: 'us-central1',
        },
      },
      runtime: {
        gateway: {
          url: 'https://api-gateway.run.app',
        },
        persistence: {
          driver: 'postgres',
        },
        envVars: {
          NODE_ENV: 'staging',
          LOG_LEVEL: 'info',
        },
      },
    } as any;

    // Setup mocks
    mockFs.existsSync.mockReturnValue(true);

    const { deriveTag } = require('../../util/git');
    deriveTag.mockReturnValue('v1.0.0-abc123');

    const { loadEnvKv, synthesizeSecretMapping } = require('../../config/loader');
    loadEnvKv.mockReturnValue('SERVICE_KEY=test-value'); // Returns string format
    synthesizeSecretMapping.mockReturnValue('API_KEY=API_KEY:latest;DATABASE_PASSWORD=DATABASE_PASSWORD:latest'); // Returns string format

    const { resolveSecretMappingToNumeric } = require('../../providers/gcp/secrets');
    resolveSecretMappingToNumeric.mockResolvedValue('API_KEY=projects/123/secrets/api-key/versions/1;DATABASE_PASSWORD=projects/123/secrets/db-pass/versions/2'); // Returns string format

    const { assertVpcPreconditions } = require('../../providers/gcp/preflight');
    assertVpcPreconditions.mockResolvedValue(undefined);
  });

  describe('name', () => {
    it('should return cloud-run', () => {
      expect(strategy.name).toBe('cloud-run');
    });
  });

  describe('prepare()', () => {
    it('should create deployment plan with GCP configuration', async () => {
      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.service.name).toBe('test-service');
      expect(plan.context.name).toBe('staging');
      expect(plan.metadata.projectId).toBe('test-project-123');
      expect(plan.metadata.region).toBe('us-central1');
      expect(plan.metadata.vpcConnector).toBeDefined();
    });

    it('should throw error if GCP configuration missing', async () => {
      const invalidContext: ResolvedContext = {
        ...mockContext,
        deployment: {
          type: 'cloud-run',
          // gcp config missing
        },
      } as any;

      await expect(strategy.prepare(mockService, invalidContext, {})).rejects.toThrow(
        /GCP configuration missing/
      );
    });

    it('should load environment variables', async () => {
      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.envVars.NODE_ENV).toBe('staging');
      expect(plan.envVars.LOG_LEVEL).toBe('info');
      expect(plan.envVars.SERVICE_KEY).toBe('test-value');
    });

    it('should resolve secrets from Secret Manager', async () => {
      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.secrets.API_KEY).toBeDefined();
      expect(plan.secrets.DATABASE_PASSWORD).toBeDefined();
    });

    it('should use external image for deploy-only', async () => {
      const serviceWithImage: ServiceWithName = {
        ...mockService,
        image: 'gcr.io/external/service:v1',
      };

      const plan = await strategy.prepare(serviceWithImage, mockContext, {});

      expect(plan.metadata.dockerfilePath).toBe('');
      expect(plan.metadata.cloudBuildConfig).toBe('cloudbuild.deploy-only.yaml');
    });

    it('should use build-and-deploy for services without external image', async () => {
      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.metadata.dockerfilePath).toBeDefined();
      expect(plan.metadata.cloudBuildConfig).toBe('cloudbuild.oauth-flow.yaml');
    });

    it('should compute Cloud Build substitutions', async () => {
      const plan = await strategy.prepare(mockService, mockContext, {});

      expect(plan.metadata.substitutions).toBeDefined();
      const subs = plan.metadata.substitutions as Record<string, string>;
      expect(subs._SERVICE_NAME).toBe('test-service');
      expect(subs._REGION).toBe('us-central1');
      expect(subs._CPU).toBe('1');
      expect(subs._MEMORY).toBe('512Mi');
      expect(subs._PORT).toBe('3000');
      expect(subs._MIN_INSTANCES).toBe('1');
      expect(subs._MAX_INSTANCES).toBe('10');
      expect(subs._VPC_CONNECTOR).toBe('brat-conn-us-central1-staging');
    });

    it('should handle dry-run mode', async () => {
      const plan = await strategy.prepare(mockService, mockContext, { dryRun: true });

      expect(plan).toBeDefined();
      expect(plan.metadata.deployOptions).toEqual({ dryRun: true });
    });
  });

  describe('validate()', () => {
    it('should pass validation when all checks pass', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when dockerfile missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Dockerfile not found');
    });

    it('should fail validation when VPC preflight fails', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const { assertVpcPreconditions } = require('../../providers/gcp/preflight');
      assertVpcPreconditions.mockRejectedValue(new Error('VPC connector not found'));

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('VPC preflight failed'));
    });

    it('should skip VPC check in dry-run mode', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, { dryRun: true });
      const result = await strategy.validate(plan);

      const { assertVpcPreconditions } = require('../../providers/gcp/preflight');
      expect(assertVpcPreconditions).not.toHaveBeenCalled();
    });

    it('should warn when VPC check skipped with allow-no-vpc', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const { assertVpcPreconditions } = require('../../providers/gcp/preflight');
      assertVpcPreconditions.mockRejectedValue(new Error('VPC not configured'));

      const plan = await strategy.prepare(mockService, mockContext, { allowNoVpc: true } as any);
      const result = await strategy.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('VPC check skipped'));
    });
  });

  describe('execute()', () => {
    it('should submit build to Cloud Build', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const { submitBuild } = require('../../providers/gcp/cloudbuild');
      submitBuild.mockResolvedValue({
        code: 0,
        stdout: 'Build ID: build-123\nBuild completed successfully',
        stderr: '',
        cmd: ['gcloud', 'builds', 'submit'],
      });

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.execute(plan);

      expect(submitBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project-123',
          substitutions: expect.any(Object),
        })
      );
      expect(result.status).toBe('success');
      expect(result.metadata?.buildId).toBe('build-123');
    });

    it('should return success result in dry-run mode', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const plan = await strategy.prepare(mockService, mockContext, { dryRun: true });
      const result = await strategy.execute(plan);

      const { submitBuild } = require('../../providers/gcp/cloudbuild');
      expect(submitBuild).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.metadata?.buildId).toBe('dry-run');
    });

    it('should return failed result on Cloud Build error', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const { submitBuild } = require('../../providers/gcp/cloudbuild');
      submitBuild.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'Build failed: compilation error',
        cmd: ['gcloud', 'builds', 'submit'],
      });

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.execute(plan);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Build failed');
    });

    it('should include Cloud Run URL in success result', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const { submitBuild } = require('../../providers/gcp/cloudbuild');
      submitBuild.mockResolvedValue({
        code: 0,
        stdout: 'Build ID: build-456\nDeployment complete',
        stderr: '',
        cmd: ['gcloud', 'builds', 'submit'],
      });

      const plan = await strategy.prepare(mockService, mockContext, {});
      const result = await strategy.execute(plan);

      expect(result.status).toBe('success');
      expect(result.url).toContain('run.app');
      expect(result.url).toContain('test-service');
    });
  });

  describe('Integration Tests', () => {
    it('should execute full deployment flow in dry-run mode', async () => {
      // This integration test validates the complete prepare -> validate -> execute flow
      // using realistic configuration (similar to actual architecture.yaml)
      mockFs.existsSync.mockReturnValue(true);

      const { submitBuild } = require('../../providers/gcp/cloudbuild');
      submitBuild.mockResolvedValue({
        code: 0,
        stdout: 'Build ID: integration-test-build\nDeployment complete',
        stderr: '',
        cmd: ['gcloud', 'builds', 'submit'],
      });

      const integrationService: ServiceWithName = {
        name: 'llm-bot',
        active: true,
        entry: 'dist/apps/llm-bot-service.js',
        port: 3002,
        region: 'us-central1',
        cpu: '2',
        memory: '1Gi',
        scaling: { min: 0, max: 3 },
        secrets: ['OPENAI_API_KEY', 'DATABASE_URL'],
      };

      const integrationContext: ResolvedContext = {
        name: 'staging',
        deployment: {
          type: 'cloud-run',
          gcp: {
            project: 'bitbrat-staging',
            region: 'us-central1',
          },
        },
        runtime: {
          gateway: {
            url: 'https://api-gateway-staging.run.app',
          },
          persistence: {
            driver: 'postgres',
          },
          envVars: {
            NODE_ENV: 'staging',
            LOG_LEVEL: 'debug',
            MESSAGE_BUS_DRIVER: 'pubsub',
          },
        },
      } as any;

      // PHASE 1: Prepare
      const plan = await strategy.prepare(integrationService, integrationContext, { dryRun: true });

      expect(plan.service.name).toBe('llm-bot');
      expect(plan.context.name).toBe('staging');
      expect(plan.metadata.projectId).toBe('bitbrat-staging');
      expect(plan.metadata.region).toBe('us-central1');
      expect(plan.metadata.vpcConnector).toBe('brat-conn-us-central1-staging');
      expect(plan.metadata.cloudBuildConfig).toBe('cloudbuild.oauth-flow.yaml');

      // Verify substitutions are computed correctly
      const subs = plan.metadata.substitutions as Record<string, string>;
      expect(subs._SERVICE_NAME).toBe('llm-bot');
      expect(subs._REGION).toBe('us-central1');
      expect(subs._CPU).toBe('2');
      expect(subs._MEMORY).toBe('1Gi');
      expect(subs._MIN_INSTANCES).toBe('0');
      expect(subs._MAX_INSTANCES).toBe('3');
      expect(subs._VPC_CONNECTOR).toBe('brat-conn-us-central1-staging');

      // Verify env vars are loaded
      expect(plan.envVars.NODE_ENV).toBe('staging');
      expect(plan.envVars.LOG_LEVEL).toBe('debug');
      expect(plan.envVars.MESSAGE_BUS_DRIVER).toBe('pubsub');

      // PHASE 2: Validate
      const validation = await strategy.validate(plan);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // PHASE 3: Execute (dry-run)
      const result = await strategy.execute(plan);

      expect(result.status).toBe('success');
      expect(result.service).toBe('llm-bot');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.buildId).toBe('dry-run');

      // Verify submitBuild was NOT called in dry-run mode
      expect(submitBuild).not.toHaveBeenCalled();
    });

    it('should handle realistic production-like configuration', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Re-mock for production-specific secrets
      const { synthesizeSecretMapping } = require('../../config/loader');
      synthesizeSecretMapping.mockReturnValue('JWT_SECRET=JWT_SECRET:latest;DATABASE_PASSWORD=DATABASE_PASSWORD:latest;REDIS_URL=REDIS_URL:latest');

      const { resolveSecretMappingToNumeric } = require('../../providers/gcp/secrets');
      resolveSecretMappingToNumeric.mockResolvedValue('JWT_SECRET=projects/123/secrets/jwt/versions/5;DATABASE_PASSWORD=projects/123/secrets/db/versions/3;REDIS_URL=projects/123/secrets/redis/versions/1');

      const prodService: ServiceWithName = {
        name: 'api-gateway',
        active: true,
        entry: 'dist/apps/api-gateway-service.js',
        port: 3000,
        region: 'us-east1',
        cpu: '4',
        memory: '2Gi',
        scaling: { min: 1, max: 10 },
        secrets: ['JWT_SECRET', 'DATABASE_PASSWORD', 'REDIS_URL'],
        security: {
          allowUnauthenticated: false,
        },
      };

      const prodContext: ResolvedContext = {
        name: 'prod',
        deployment: {
          type: 'cloud-run',
          gcp: {
            project: 'bitbrat-prod-123',
            region: 'us-east1',
          },
        },
        runtime: {
          gateway: {
            url: 'https://api.bitbrat.com',
          },
          persistence: {
            driver: 'postgres',
          },
          envVars: {
            NODE_ENV: 'production',
            LOG_LEVEL: 'warn',
            MESSAGE_BUS_DRIVER: 'pubsub',
            ENABLE_METRICS: 'true',
          },
        },
      } as any;

      const plan = await strategy.prepare(prodService, prodContext, { dryRun: true });

      // Verify production configuration
      expect(plan.metadata.projectId).toBe('bitbrat-prod-123');
      expect(plan.metadata.region).toBe('us-east1');
      expect(plan.metadata.vpcConnector).toBe('brat-conn-us-east1-prod');

      const subs = plan.metadata.substitutions as Record<string, string>;
      expect(subs._CPU).toBe('4');
      expect(subs._MEMORY).toBe('2Gi');
      expect(subs._MIN_INSTANCES).toBe('1');
      expect(subs._MAX_INSTANCES).toBe('10');
      expect(subs._ALLOW_UNAUTH).toBe('false');

      // Verify secrets are configured
      expect(plan.metadata.substitutions?._SECRET_SET_ARG).toContain('JWT_SECRET');
      expect(plan.metadata.substitutions?._SECRET_SET_ARG).toContain('DATABASE_PASSWORD');
      expect(plan.metadata.substitutions?._SECRET_SET_ARG).toContain('REDIS_URL');

      const validation = await strategy.validate(plan);
      expect(validation.valid).toBe(true);
    });
  });
});
