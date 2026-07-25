/**
 * Global Test Setup for oclif Commands
 * Sprint 359: Mocks shared dependencies to enable integration testing
 */

import { jest } from '@jest/globals';

// Mock ContextResolver before any tests run
jest.mock('../../context/context-resolver', () => {
  return {
    ContextResolver: jest.fn().mockImplementation(() => {
      return {
        resolve: jest.fn().mockResolvedValue({
          name: 'local',
          deployment: {
            type: 'docker-compose',
            docker: { host: 'unix:///var/run/docker.sock' },
          },
          runtime: {
            gateway: { fallbackPort: 3000 },
            persistence: {
              driver: 'postgres',
              connection: {
                host: 'localhost',
                port: 5432,
                database: 'bitbrat',
                username: 'bitbrat',
                password: 'test-password',
              },
            },
          },
        }),
      };
    }),
    ContextResolutionError: class ContextResolutionError extends Error {},
  };
});

// Mock logger
jest.mock('../../orchestration/logger', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
  };

  return {
    createLogger: jest.fn().mockReturnValue(mockLogger),
    Logger: jest.fn(),
  };
});

// Mock fs for architecture.yaml access
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue('mock: yaml'),
  };
});

// Export empty object to satisfy TypeScript
export {};
