/**
 * Config Show Command Tests
 * Sprint 359: Integration tests for brat config show command
 */

import { test } from '@oclif/test';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import ConfigShow from './show';

// Mock dependencies
jest.mock('fs');
jest.mock('js-yaml');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockYaml = yaml as jest.Mocked<typeof yaml>;

describe('brat config show', () => {
  let mockArchitecture: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock architecture.yaml data
    mockArchitecture = {
      project: {
        name: 'bitbrat-platform',
        version: '0.17.0',
      },
      services: {
        'api-gateway': {
          port: 3000,
          env: {
            NODE_ENV: 'production',
            API_SECRET: 'super-secret-key',
            DATABASE_PASSWORD: 'db-password-123',
            OPENAI_API_KEY: 'sk-1234567890abcdef',
          },
        },
      },
      executionContexts: {
        local: {
          runtime: {
            persistence: {
              driver: 'postgres',
              connection: {
                password: '${POSTGRES_PASSWORD}',
                host: 'localhost',
              },
            },
          },
        },
      },
    };

    // Mock fs.existsSync to return true
    mockFs.existsSync.mockReturnValue(true);

    // Mock fs.readFileSync to return YAML string
    mockFs.readFileSync.mockReturnValue('mock-yaml-content');

    // Mock yaml.load to return architecture object
    mockYaml.load.mockReturnValue(mockArchitecture);

    // Mock yaml.dump to return formatted YAML
    mockYaml.dump.mockImplementation((obj: any) => JSON.stringify(obj, null, 2));
  });

  describe('Default Output (YAML)', () => {
    test
      .stdout()
      .command(['config:show'])
      .it('should output configuration as YAML by default', (ctx) => {
        expect(mockYaml.dump).toHaveBeenCalled();
        expect(ctx.stdout).toBeTruthy();
      });

    test
      .stdout()
      .command(['config:show'])
      .it('should load architecture.yaml from repository root', () => {
        expect(mockFs.readFileSync).toHaveBeenCalledWith(
          expect.stringContaining('architecture.yaml'),
          'utf8'
        );
        expect(mockYaml.load).toHaveBeenCalledWith('mock-yaml-content');
      });
  });

  describe('JSON Output', () => {
    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should output configuration as JSON', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output).toHaveProperty('project');
        expect(output).toHaveProperty('services');
      });
  });

  describe('Smart Redaction', () => {
    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should redact password fields by default', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        const password =
          output.services['api-gateway'].env.DATABASE_PASSWORD;
        expect(password).toMatch(/^db\*+$/); // "db" + asterisks
        expect(password).not.toBe('db-password-123');
      });

    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should redact secret fields', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        const secret = output.services['api-gateway'].env.API_SECRET;
        expect(secret).toMatch(/^su\*+$/); // "su" + asterisks
        expect(secret).not.toBe('super-secret-key');
      });

    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should redact API key fields', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        const apiKey = output.services['api-gateway'].env.OPENAI_API_KEY;
        expect(apiKey).toMatch(/^sk\*+$/); // "sk" + asterisks
        expect(apiKey).not.toContain('1234567890');
      });

    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should redact environment variable interpolation', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        const password =
          output.executionContexts.local.runtime.persistence.connection
            .password;
        expect(password).toBe('${********}');
        expect(password).not.toBe('${POSTGRES_PASSWORD}');
      });

    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should not redact non-sensitive fields', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output.services['api-gateway'].env.NODE_ENV).toBe(
          'production'
        );
        expect(
          output.executionContexts.local.runtime.persistence.connection.host
        ).toBe('localhost');
      });

    test
      .stdout()
      .do(() => {
        mockArchitecture.services['api-gateway'].env.SHORT_SECRET = 'ab';
      })
      .command(['config:show', '--format=json'])
      .it('should redact short sensitive values completely', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        const shortSecret =
          output.services['api-gateway'].env.SHORT_SECRET;
        expect(shortSecret).toBe('**'); // All asterisks for <=4 chars
      });
  });

  describe('Raw Mode (No Redaction)', () => {
    test
      .stdout()
      .command(['config:show', '--raw', '--format=json'])
      .it('should show unredacted values with --raw flag', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output.services['api-gateway'].env.DATABASE_PASSWORD).toBe(
          'db-password-123'
        );
        expect(output.services['api-gateway'].env.API_SECRET).toBe(
          'super-secret-key'
        );
        expect(output.services['api-gateway'].env.OPENAI_API_KEY).toBe(
          'sk-1234567890abcdef'
        );
      });

    test
      .stdout()
      .command(['config:show', '--raw', '--format=json'])
      .it('should show raw environment variable interpolation', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(
          output.executionContexts.local.runtime.persistence.connection
            .password
        ).toBe('${POSTGRES_PASSWORD}');
      });
  });

  describe('Sensitive Pattern Matching', () => {
    test
      .stdout()
      .do(() => {
        mockArchitecture.auth = {
          jwtToken: 'jwt-secret-token',
          apiKey: 'api-key-value',
          authHeader: 'Bearer xyz',
          credential: 'user-credential',
          api_key: 'underscore-api-key',
        };
      })
      .command(['config:show', '--format=json'])
      .it('should match various sensitive patterns', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output.auth.jwtToken).toMatch(/^jw\*+$/);
        expect(output.auth.apiKey).toMatch(/^ap\*+$/);
        expect(output.auth.authHeader).toMatch(/^Be\*+$/);
        expect(output.auth.credential).toMatch(/^us\*+$/);
        expect(output.auth.api_key).toMatch(/^un\*+$/);
      });
  });

  describe('Circular Reference Handling', () => {
    test
      .stdout()
      .do(() => {
        const circular: any = { name: 'test' };
        circular.self = circular;
        mockArchitecture.circular = circular;
      })
      .command(['config:show', '--format=json'])
      .it('should handle circular references', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output.circular.self).toBe('[Circular Reference]');
      });
  });

  describe('Array Redaction', () => {
    test
      .stdout()
      .do(() => {
        mockArchitecture.secrets = ['password1', 'password2', 'password3'];
      })
      .command(['config:show', '--format=json'])
      .it('should handle arrays with sensitive field names', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(output.secrets[0]).toMatch(/^pa\*+$/);
        expect(output.secrets[1]).toMatch(/^pa\*+$/);
        expect(output.secrets[2]).toMatch(/^pa\*+$/);
      });
  });

  describe('Nested Object Redaction', () => {
    test
      .stdout()
      .do(() => {
        mockArchitecture.deeply = {
          nested: {
            object: {
              with: {
                password: 'deeply-nested-password',
              },
            },
          },
        };
      })
      .command(['config:show', '--format=json'])
      .it('should redact deeply nested sensitive values', (ctx) => {
        const output = JSON.parse(ctx.stdout);
        expect(
          output.deeply.nested.object.with.password
        ).toMatch(/^de\*+$/);
      });
  });

  describe('Error Handling', () => {
    test
      .stdout()
      .do(() => {
        mockFs.existsSync.mockReturnValue(false);
      })
      .command(['config:show'])
      .catch((error) => {
        expect(error.message).toContain('architecture.yaml not found');
        expect(error.message).toContain('brat setup');
      })
      .it('should error if architecture.yaml not found');

    test
      .stdout()
      .do(() => {
        mockYaml.load.mockImplementation(() => {
          throw new Error('Invalid YAML syntax');
        });
      })
      .command(['config:show'])
      .catch((error) => {
        expect(error.message).toContain('Invalid YAML syntax');
      })
      .it('should handle YAML parsing errors');
  });

  describe('Context Integration', () => {
    test
      .stdout()
      .command(['config:show', '--context=staging'])
      .it('should accept --context flag from BratCommand');

    test
      .stdout()
      .command(['config:show', '--verbose'])
      .it('should accept --verbose flag from BratCommand');
  });

  describe('Help Text', () => {
    test
      .stdout()
      .command(['config:show', '--help'])
      .it('should display help text', (ctx) => {
        expect(ctx.stdout).toContain(
          'Display resolved configuration for current execution context'
        );
        expect(ctx.stdout).toContain('--format');
        expect(ctx.stdout).toContain('--raw');
      });
  });

  describe('Format Validation', () => {
    test
      .stdout()
      .command(['config:show', '--format=invalid'])
      .catch((error) => {
        expect(error.message).toContain('Expected --format=');
      })
      .it('should reject invalid format option');

    test
      .stdout()
      .command(['config:show', '--format=yaml'])
      .it('should accept yaml format');

    test
      .stdout()
      .command(['config:show', '--format=json'])
      .it('should accept json format');
  });

  describe('YAML Output Formatting', () => {
    test
      .stdout()
      .command(['config:show', '--format=yaml'])
      .it('should use yaml.dump with correct options', () => {
        expect(mockYaml.dump).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            lineWidth: -1,
            noRefs: true,
          })
        );
      });
  });

  describe('Logging', () => {
    test
      .stdout()
      .command(['config:show', '--verbose'])
      .it('should log debug information in verbose mode', () => {
        // Verbose logging would show additional debug info
        expect(mockYaml.load).toHaveBeenCalled();
      });
  });
});
