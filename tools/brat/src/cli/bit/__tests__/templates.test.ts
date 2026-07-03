/**
 * Unit tests for template generation
 * Sprint 331: BL-331-202
 */

import { generateAppSource, generateTest, generateDockerfile, generateCompose, TemplateOptions } from '../templates';

describe('generateAppSource', () => {
  describe('profile: core', () => {
    it('should generate basic core Bit with platform-only exposure', () => {
      const opts: TemplateOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        port: 3000,
      };
      const source = generateAppSource(opts);

      expect(source).toContain('class TestServiceServer extends Bit');
      expect(source).toContain("{ mcpExposure: 'platform-only' }");
      expect(source).toContain("import { Bit } from '../common/base-server'");
      expect(source).not.toContain('import { z }');
      expect(source).not.toContain('import { Request, Response }');
    });

    it('should generate core Bit with none exposure', () => {
      const opts: TemplateOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'none',
        kind: 'pipeline-service',
      };
      const source = generateAppSource(opts);

      expect(source).toContain('super();');
      expect(source).not.toContain('mcpExposure');
    });
  });

  describe('profile: gateway', () => {
    it('should generate gateway Bit with HTTP routes', () => {
      const opts: TemplateOptions = {
        name: 'api-gateway',
        profile: 'gateway',
        exposure: 'platform+domain',
        kind: 'gateway',
        port: 8080,
      };
      const source = generateAppSource(opts);

      expect(source).toContain("import { Request, Response } from 'express'");
      expect(source).toContain('setupRoutes()');
      expect(source).toContain("{ mcpExposure: 'platform+domain' }");
      expect(source).toContain('private setupRoutes()');
      expect(source).toContain("app.get('/health'");
    });

    it('should include explicit routes if paths provided', () => {
      const opts: TemplateOptions = {
        name: 'api-gateway',
        profile: 'gateway',
        exposure: 'platform-only',
        kind: 'gateway',
        paths: ['/api/users', '/api/posts'],
      };
      const source = generateAppSource(opts);

      expect(source).toContain("app.get('/api/users'");
      expect(source).toContain("app.get('/api/posts'");
    });
  });

  describe('profile: mcp-domain', () => {
    it('should generate MCP tool server with registerTool example', () => {
      const opts: TemplateOptions = {
        name: 'custom-tools',
        profile: 'mcp-domain',
        exposure: 'platform+domain',
        kind: 'mcp-server',
      };
      const source = generateAppSource(opts);

      expect(source).toContain("import { z } from 'zod'");
      expect(source).toContain('registerDomainTools()');
      expect(source).toContain('this.registerTool(');
      expect(source).toContain("'echo'");
      expect(source).toContain('z.object');
    });
  });

  describe('profile: llm', () => {
    it('should generate LLM Bit with provider initialization comment', () => {
      const opts: TemplateOptions = {
        name: 'llm-service',
        profile: 'llm',
        exposure: 'platform-only',
        kind: 'pipeline-service',
      };
      const source = generateAppSource(opts);

      expect(source).toContain('setupLLM');
      expect(source).toContain('TODO: Initialize LLM provider');
    });
  });

  describe('class naming', () => {
    it('should convert kebab-case to PascalCase', () => {
      const opts: TemplateOptions = {
        name: 'my-test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
      };
      const source = generateAppSource(opts);

      expect(source).toContain('class MyTestServiceServer extends Bit');
    });
  });

  describe('module execution', () => {
    it('should include require.main check', () => {
      const opts: TemplateOptions = {
        name: 'test-service',
        profile: 'core',
        exposure: 'platform-only',
        kind: 'pipeline-service',
        port: 3001,
      };
      const source = generateAppSource(opts);

      expect(source).toContain('if (require.main === module)');
      expect(source).toContain("const port = parseInt(process.env.PORT || '3001', 10)");
      expect(source).toContain('server.start(port)');
    });
  });
});

describe('generateTest', () => {
  it('should generate basic test file', () => {
    const test = generateTest('my-service', 'src/apps/my-service.ts');

    expect(test).toContain("import request from 'supertest'");
    expect(test).toContain('import { MyServiceServer }');
    expect(test).toContain("describe('my-service'");
    expect(test).toContain('beforeAll');
    expect(test).toContain('afterAll');
    expect(test).toContain('await server.close(');
  });

  it('should include health check test', () => {
    const test = generateTest('test-service', 'src/apps/test-service.ts');

    expect(test).toContain("it('should respond to health check'");
    expect(test).toContain("get('/healthz')");
    expect(test).toContain('expect(response.status).toBe(200)');
  });

  it('should handle nested entry paths', () => {
    const test = generateTest('my-service', 'src/apps/subfolder/my-service.ts');

    expect(test).toContain('import { MyServiceServer }');
    expect(test).toContain("from './my-service'");
  });
});

describe('generateDockerfile', () => {
  it('should generate multi-stage Dockerfile', () => {
    const dockerfile = generateDockerfile('my-service', 'src/apps/my-service.ts');

    expect(dockerfile).toContain('FROM node:24-slim AS builder');
    expect(dockerfile).toContain('FROM node:24-slim');
    expect(dockerfile).toContain('npm ci');
    expect(dockerfile).toContain('npm run build');
    expect(dockerfile).toContain('COPY architecture.yaml ./');
  });

  it('should set correct entry point', () => {
    const dockerfile = generateDockerfile('test-service', 'src/apps/test-service.ts');

    expect(dockerfile).toContain('CMD ["node", "dist/apps/test-service.js"]');
  });

  it('should set SERVICE_NAME environment variable', () => {
    const dockerfile = generateDockerfile('my-service', 'src/apps/my-service.ts');

    expect(dockerfile).toContain('ENV SERVICE_NAME=my-service');
  });
});

describe('generateCompose', () => {
  it('should generate docker-compose service definition', () => {
    const compose = generateCompose('my-service', 3000, [], []);

    expect(compose).toContain('services:');
    expect(compose).toContain('my-service:');
    expect(compose).toContain('build:');
    expect(compose).toContain('Dockerfile.my-service');
  });

  it('should set correct port mapping', () => {
    const compose = generateCompose('test-service', 8080, [], []);

    expect(compose).toContain('- "${TEST_SERVICE_HOST_PORT:-8080}:8080"');
    expect(compose).toContain('PORT=8080');
  });

  it('should include environment variables', () => {
    const compose = generateCompose('my-service', 3000, ['VAR1', 'VAR2'], []);

    expect(compose).toContain('- VAR1=${VAR1}');
    expect(compose).toContain('- VAR2=${VAR2}');
  });

  it('should include secrets', () => {
    const compose = generateCompose('my-service', 3000, [], ['SECRET1', 'SECRET2']);

    expect(compose).toContain('- SECRET1=${SECRET1}');
    expect(compose).toContain('- SECRET2=${SECRET2}');
  });

  it('should include healthcheck', () => {
    const compose = generateCompose('my-service', 3000, [], []);

    expect(compose).toContain('healthcheck:');
    expect(compose).toContain('curl');
    expect(compose).toContain('/health');
  });

  it('should depend on nats and firebase-emulator', () => {
    const compose = generateCompose('my-service', 3000, [], []);

    expect(compose).toContain('depends_on:');
    expect(compose).toContain('nats:');
    expect(compose).toContain('firebase-emulator:');
    expect(compose).toContain('condition: service_healthy');
  });

  it('should use bitbrat-network', () => {
    const compose = generateCompose('my-service', 3000, [], []);

    expect(compose).toContain('networks:');
    expect(compose).toContain('- bitbrat-network');
    expect(compose).toContain('bitbrat-network:');
    expect(compose).toContain('external: true');
  });
});
