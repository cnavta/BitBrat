/**
 * Redaction Module Unit Tests
 * Sprint 360: Test suite for business/redaction.ts
 */

import {
  isSensitiveField,
  redactString,
  redactSensitiveValues,
  redact,
  SENSITIVE_PATTERNS,
} from './redaction';

describe('Redaction Business Logic', () => {
  describe('isSensitiveField', () => {
    it('should detect password fields', () => {
      expect(isSensitiveField('password')).toBe(true);
      expect(isSensitiveField('Password')).toBe(true);
      expect(isSensitiveField('POSTGRES_PASSWORD')).toBe(true);
      expect(isSensitiveField('userPassword')).toBe(true);
    });

    it('should detect token fields', () => {
      expect(isSensitiveField('token')).toBe(true);
      expect(isSensitiveField('authToken')).toBe(true);
      expect(isSensitiveField('MCP_AUTH_TOKEN')).toBe(true);
      expect(isSensitiveField('accessToken')).toBe(true);
    });

    it('should detect secret fields', () => {
      expect(isSensitiveField('secret')).toBe(true);
      expect(isSensitiveField('clientSecret')).toBe(true);
      expect(isSensitiveField('API_SECRET')).toBe(true);
    });

    it('should detect API key fields', () => {
      expect(isSensitiveField('apiKey')).toBe(true);
      expect(isSensitiveField('apikey')).toBe(true);
      expect(isSensitiveField('api_key')).toBe(true);
      expect(isSensitiveField('OPENAI_API_KEY')).toBe(true);
    });

    it('should detect credential fields', () => {
      expect(isSensitiveField('credential')).toBe(true);
      expect(isSensitiveField('credentials')).toBe(true);
      expect(isSensitiveField('userCredentials')).toBe(true);
    });

    it('should detect auth fields', () => {
      expect(isSensitiveField('auth')).toBe(true);
      expect(isSensitiveField('authorization')).toBe(true);
      expect(isSensitiveField('basicAuth')).toBe(true);
    });

    it('should not flag non-sensitive fields', () => {
      expect(isSensitiveField('username')).toBe(false);
      expect(isSensitiveField('email')).toBe(false);
      expect(isSensitiveField('host')).toBe(false);
      expect(isSensitiveField('port')).toBe(false);
      expect(isSensitiveField('database')).toBe(false);
    });

    it('should support additional patterns', () => {
      const customPattern = /private.*key/i; // More permissive pattern
      expect(isSensitiveField('privateKey', [customPattern])).toBe(true);
      expect(isSensitiveField('PRIVATE_KEY', [customPattern])).toBe(true);
      expect(isSensitiveField('userPrivateKey', [customPattern])).toBe(true);
    });
  });

  describe('redactString', () => {
    it('should return empty string for empty input', () => {
      expect(redactString('')).toBe('');
    });

    it('should redact environment variable interpolation', () => {
      expect(redactString('${POSTGRES_PASSWORD}')).toBe('${********}');
      expect(redactString('${MCP_AUTH_TOKEN}')).toBe('${********}');
      expect(redactString('${API_KEY}')).toBe('${********}');
    });

    it('should redact short values (≤4 chars) with all asterisks', () => {
      expect(redactString('a')).toBe('*');
      expect(redactString('ab')).toBe('**');
      expect(redactString('abc')).toBe('***');
      expect(redactString('abcd')).toBe('****');
    });

    it('should redact long values with prefix + asterisks', () => {
      expect(redactString('password123')).toBe('pa********');
      expect(redactString('sk-test-1234567890')).toBe('sk********');
      expect(redactString('very-long-secret-value')).toBe('ve********');
    });

    it('should respect custom prefix length', () => {
      expect(redactString('password123', { prefixLength: 4 })).toBe('pass********');
      expect(redactString('password123', { prefixLength: 0 })).toBe('********');
      expect(redactString('password123', { prefixLength: 6 })).toBe('passwo********');
    });

    it('should respect custom redaction length', () => {
      expect(redactString('password123', { redactionLength: 4 })).toBe('pa****');
      expect(redactString('password123', { redactionLength: 12 })).toBe('pa************');
    });
  });

  describe('redactSensitiveValues', () => {
    it('should redact top-level sensitive fields', () => {
      const input = {
        username: 'admin',
        password: 'secret123',
        email: 'admin@example.com',
        token: 'bearer-xyz',
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        username: 'admin',
        password: 'se********',
        email: 'admin@example.com',
        token: 'be********',
      });
      expect(result.redactedCount).toBe(2);
      expect(result.redactedPaths).toEqual(['password', 'token']);
    });

    it('should redact nested objects', () => {
      const input = {
        database: {
          host: 'localhost',
          port: 5432,
          password: 'db-secret',
        },
        api: {
          url: 'https://api.example.com',
          apiKey: 'sk-test',
        },
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        database: {
          host: 'localhost',
          port: 5432,
          password: 'db********',
        },
        api: {
          url: 'https://api.example.com',
          apiKey: 'sk********',
        },
      });
      expect(result.redactedCount).toBe(2);
      expect(result.redactedPaths).toEqual(['database.password', 'api.apiKey']);
    });

    it('should handle arrays', () => {
      const input = {
        users: [
          { name: 'alice', password: 'alice123' },
          { name: 'bob', password: 'bob456' },
        ],
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        users: [
          { name: 'alice', password: 'al********' },
          { name: 'bob', password: 'bo********' },
        ],
      });
      expect(result.redactedCount).toBe(2);
      expect(result.redactedPaths).toEqual(['users[0].password', 'users[1].password']);
    });

    it('should handle environment variable interpolation', () => {
      const input = {
        database: {
          host: 'localhost',
          password: '${POSTGRES_PASSWORD}',
        },
        gateway: {
          authToken: '${MCP_AUTH_TOKEN}',
        },
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        database: {
          host: 'localhost',
          password: '${********}',
        },
        gateway: {
          authToken: '${********}',
        },
      });
      expect(result.redactedCount).toBe(2);
    });

    it('should handle null and undefined values', () => {
      const input = {
        username: 'admin',
        password: null,
        token: undefined,
        apiKey: '',
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        username: 'admin',
        password: null,
        token: undefined,
        apiKey: '',
      });
      // Empty string is redacted but returns empty string (count still increments)
      expect(result.redactedCount).toBe(1);
    });

    it('should handle primitives', () => {
      expect(redactSensitiveValues(null).value).toBe(null);
      expect(redactSensitiveValues(undefined).value).toBe(undefined);
      expect(redactSensitiveValues('string').value).toBe('string');
      expect(redactSensitiveValues(123).value).toBe(123);
      expect(redactSensitiveValues(true).value).toBe(true);
    });

    it('should handle circular references with marker (default)', () => {
      const input: any = { name: 'test' };
      input.self = input;

      const result = redactSensitiveValues(input);

      expect(result.value.name).toBe('test');
      expect(result.value.self).toBe('[Circular Reference]');
    });

    it('should throw on circular references when configured', () => {
      const input: any = { name: 'test' };
      input.self = input;

      expect(() => {
        redactSensitiveValues(input, { circularRefHandler: 'throw' });
      }).toThrow('Circular reference detected at path: self');
    });

    it('should ignore circular references when configured', () => {
      const input: any = { name: 'test' };
      input.self = input;

      const result = redactSensitiveValues(input, { circularRefHandler: 'ignore' });

      expect(result.value.name).toBe('test');
      expect(result.value.self).toBe(undefined);
    });

    it('should support additional patterns', () => {
      const input = {
        username: 'admin',
        customSecret: 'my-secret',
      };

      const result = redactSensitiveValues(input, {
        additionalPatterns: [/customSecret/i],
      });

      expect(result.value).toEqual({
        username: 'admin',
        customSecret: 'my********',
      });
      expect(result.redactedCount).toBe(1);
      expect(result.redactedPaths).toEqual(['customSecret']);
    });

    it('should handle complex nested structures', () => {
      const input = {
        name: 'staging',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://root@bitbrat.lan',
          },
        },
        runtime: {
          gateway: {
            url: 'http://localhost:3000',
            authToken: '${MCP_AUTH_TOKEN}',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'bitbrat.lan',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: '${POSTGRES_PASSWORD}',
            },
          },
        },
      };

      const result = redactSensitiveValues(input);

      expect(result.value.name).toBe('staging');
      expect(result.value.runtime.gateway.url).toBe('http://localhost:3000');
      expect(result.value.runtime.gateway.authToken).toBe('${********}');
      expect(result.value.runtime.persistence.connection.host).toBe('bitbrat.lan');
      expect(result.value.runtime.persistence.connection.username).toBe('bitbrat');
      expect(result.value.runtime.persistence.connection.password).toBe('${********}');
      expect(result.redactedCount).toBe(2);
      expect(result.redactedPaths).toContain('runtime.gateway.authToken');
      expect(result.redactedPaths).toContain('runtime.persistence.connection.password');
    });
  });

  describe('redact (convenience function)', () => {
    it('should return only the redacted value without metadata', () => {
      const input = {
        username: 'admin',
        password: 'secret123',
      };

      const result = redact(input);

      expect(result).toEqual({
        username: 'admin',
        password: 'se********',
      });
      // Should not have redactedCount or redactedPaths
      expect((result as any).redactedCount).toBeUndefined();
      expect((result as any).redactedPaths).toBeUndefined();
    });

    it('should accept options', () => {
      const input = {
        password: 'secret123',
      };

      const result = redact(input, { prefixLength: 4 });

      expect(result).toEqual({
        password: 'secr********',
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty objects', () => {
      const result = redactSensitiveValues({});
      expect(result.value).toEqual({});
      expect(result.redactedCount).toBe(0);
      expect(result.redactedPaths).toEqual([]);
    });

    it('should handle empty arrays', () => {
      const result = redactSensitiveValues([]);
      expect(result.value).toEqual([]);
      expect(result.redactedCount).toBe(0);
      expect(result.redactedPaths).toEqual([]);
    });

    it('should handle mixed arrays', () => {
      const input = [
        'string',
        123,
        { password: 'secret' },
        null,
        undefined,
      ];

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual([
        'string',
        123,
        { password: 'se********' },
        null,
        undefined,
      ]);
      expect(result.redactedCount).toBe(1);
      expect(result.redactedPaths).toEqual(['[2].password']);
    });

    it('should not redact non-string sensitive values', () => {
      const input = {
        password: 12345, // number, not string
        token: true,     // boolean, not string
        secret: null,    // null, not string
      };

      const result = redactSensitiveValues(input);

      expect(result.value).toEqual({
        password: 12345,
        token: true,
        secret: null,
      });
      expect(result.redactedCount).toBe(0);
    });
  });
});
