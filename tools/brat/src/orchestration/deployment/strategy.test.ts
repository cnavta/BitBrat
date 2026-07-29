/**
 * Unit tests for deployment strategy framework
 *
 * @module orchestration/deployment/strategy.test
 * @since Sprint 372
 */

import { StrategyFactory } from './strategy';
import type {
  DeploymentStrategy,
  DeploymentPlan,
  DeploymentResult,
  ValidationResult,
  DeployOptions,
} from './strategy';

describe('Deployment Strategy Framework', () => {
  describe('StrategyFactory', () => {
    describe('create()', () => {
      it('should create docker-compose strategy', () => {
        const strategy = StrategyFactory.create('docker-compose');
        expect(strategy).toBeDefined();
        expect(strategy.name).toBe('docker-compose');
      });

      it('should create cloud-run strategy', () => {
        const strategy = StrategyFactory.create('cloud-run');
        expect(strategy).toBeDefined();
        expect(strategy.name).toBe('cloud-run');
      });

      it('should throw error for kubernetes (future)', () => {
        expect(() => StrategyFactory.create('k8s')).toThrow(
          /not yet implemented.*future sprint/
        );

        expect(() => StrategyFactory.create('kubernetes')).toThrow(
          /not yet implemented.*future sprint/
        );
      });

      it('should throw error for unknown deployment type', () => {
        expect(() => StrategyFactory.create('invalid')).toThrow(
          /Unknown deployment type: 'invalid'/
        );
      });

      it('should provide helpful error message with supported types', () => {
        try {
          StrategyFactory.create('unknown');
          fail('Should have thrown error');
        } catch (err: any) {
          expect(err.message).toContain('docker-compose');
          expect(err.message).toContain('cloud-run');
          expect(err.message).toContain('architecture.yaml');
        }
      });
    });
  });

  describe('Type Contracts', () => {
    describe('DeployOptions', () => {
      it('should accept all standard flags', () => {
        const options: DeployOptions = {
          dryRun: true,
          forceRecreate: true,
          forceBuild: true,
          concurrency: 2,
          verbose: true,
        };

        expect(options.dryRun).toBe(true);
        expect(options.forceRecreate).toBe(true);
        expect(options.forceBuild).toBe(true);
        expect(options.concurrency).toBe(2);
        expect(options.verbose).toBe(true);
      });

      it('should accept empty options', () => {
        const options: DeployOptions = {};
        expect(options).toEqual({});
      });

      it('should accept additional strategy-specific options', () => {
        const options: DeployOptions = {
          dryRun: true,
          customFlag: 'value',
          strategySpecific: 123,
        };

        expect(options.dryRun).toBe(true);
        expect(options.customFlag).toBe('value');
        expect(options.strategySpecific).toBe(123);
      });
    });

    describe('DeploymentPlan', () => {
      it('should have required fields', () => {
        const plan: DeploymentPlan = {
          service: { name: 'test-service', active: true },
          context: {} as any,
          envVars: { NODE_ENV: 'test' },
          secrets: { API_KEY: 'secret' },
          metadata: {},
        };

        expect(plan.service.name).toBe('test-service');
        expect(plan.envVars.NODE_ENV).toBe('test');
        expect(plan.secrets.API_KEY).toBe('secret');
      });

      it('should accept strategy-specific metadata', () => {
        const plan: DeploymentPlan = {
          service: { name: 'test', active: true },
          context: {} as any,
          envVars: {},
          secrets: {},
          metadata: {
            dockerfilePath: './Dockerfile',
            imageTag: 'v1.0.0',
            customField: 'value',
          },
        };

        expect(plan.metadata.dockerfilePath).toBe('./Dockerfile');
        expect(plan.metadata.imageTag).toBe('v1.0.0');
        expect(plan.metadata.customField).toBe('value');
      });
    });

    describe('ValidationResult', () => {
      it('should represent successful validation', () => {
        const result: ValidationResult = {
          valid: true,
          errors: [],
          warnings: [],
        };

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it('should represent validation failure', () => {
        const result: ValidationResult = {
          valid: false,
          errors: ['Missing Dockerfile', 'VPC check failed'],
          warnings: ['Using default memory limit'],
        };

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.warnings).toHaveLength(1);
      });
    });

    describe('DeploymentResult', () => {
      it('should represent successful deployment', () => {
        const result: DeploymentResult = {
          status: 'success',
          service: 'test-service',
          durationMs: 5000,
          url: 'https://test-service.run.app',
          metadata: {
            buildId: 'build-123',
          },
        };

        expect(result.status).toBe('success');
        expect(result.service).toBe('test-service');
        expect(result.durationMs).toBe(5000);
        expect(result.url).toBe('https://test-service.run.app');
        expect(result.metadata?.buildId).toBe('build-123');
      });

      it('should represent failed deployment', () => {
        const result: DeploymentResult = {
          status: 'failed',
          service: 'test-service',
          durationMs: 2000,
          error: 'Build failed: compilation error',
        };

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Build failed: compilation error');
      });

      it('should represent skipped deployment', () => {
        const result: DeploymentResult = {
          status: 'skipped',
          service: 'test-service',
          durationMs: 100,
        };

        expect(result.status).toBe('skipped');
        expect(result.error).toBeUndefined();
      });
    });

    describe('DeploymentStrategy interface', () => {
      it('should define required methods', () => {
        // This is a compile-time test - if this compiles, the interface is correct
        const mockStrategy: DeploymentStrategy = {
          name: 'test-strategy',
          prepare: async (_service, _context, _options) => ({} as DeploymentPlan),
          validate: async (_plan) => ({ valid: true, errors: [], warnings: [] }),
          execute: async (_plan) => ({
            status: 'success',
            service: 'test',
            durationMs: 0,
          }),
        };

        expect(mockStrategy.name).toBe('test-strategy');
        expect(typeof mockStrategy.prepare).toBe('function');
        expect(typeof mockStrategy.validate).toBe('function');
        expect(typeof mockStrategy.execute).toBe('function');
      });
    });
  });
});
