/**
 * Sprint 26 T2.2: Unit tests for environment file parser
 *
 * Tests parseEnvFile, serializeEnvFile, mergeEnv, and related utilities
 */

import {
  parseEnvFile,
  serializeEnvFile,
  mergeEnv,
  filterEnvByPrefix,
  validateRequiredVars,
} from '../env-parser';

describe('Environment File Parser (T2.2)', () => {
  describe('parseEnvFile', () => {
    it('should parse simple key-value pairs', () => {
      const content = `
DATABASE_URL=postgresql://localhost:5432/mydb
API_KEY=secret-key
PORT=3000
`;
      const env = parseEnvFile(content);

      expect(env.get('DATABASE_URL')).toBe('postgresql://localhost:5432/mydb');
      expect(env.get('API_KEY')).toBe('secret-key');
      expect(env.get('PORT')).toBe('3000');
    });

    it('should handle quoted values', () => {
      const content = `
SYSTEM_PROMPT="You are a helpful assistant."
SINGLE_QUOTED='Another value'
`;
      const env = parseEnvFile(content);

      expect(env.get('SYSTEM_PROMPT')).toBe('You are a helpful assistant.');
      expect(env.get('SINGLE_QUOTED')).toBe('Another value');
    });

    it('should skip comments and blank lines', () => {
      const content = `
# This is a comment
DATABASE_URL=postgresql://localhost:5432/mydb

# Another comment
API_KEY=secret-key

`;
      const env = parseEnvFile(content);

      expect(env.size).toBe(2);
      expect(env.get('DATABASE_URL')).toBe('postgresql://localhost:5432/mydb');
      expect(env.get('API_KEY')).toBe('secret-key');
    });

    it('should handle empty values', () => {
      const content = `
REQUIRED_VAR=value
OPTIONAL_VAR=
ANOTHER_OPTIONAL=
`;
      const env = parseEnvFile(content);

      expect(env.get('REQUIRED_VAR')).toBe('value');
      expect(env.get('OPTIONAL_VAR')).toBe('');
      expect(env.get('ANOTHER_OPTIONAL')).toBe('');
    });

    it('should ignore invalid lines', () => {
      const content = `
DATABASE_URL=postgresql://localhost:5432/mydb
This is not a valid line
ANOTHER LINE WITHOUT EQUALS
API_KEY=secret-key
`;
      const env = parseEnvFile(content);

      expect(env.size).toBe(2);
      expect(env.get('DATABASE_URL')).toBe('postgresql://localhost:5432/mydb');
      expect(env.get('API_KEY')).toBe('secret-key');
    });

    it('should handle values with equals signs', () => {
      const content = `
MATH_EXPRESSION=1+1=2
CONNECTION_STRING=Server=localhost;Database=mydb;
`;
      const env = parseEnvFile(content);

      expect(env.get('MATH_EXPRESSION')).toBe('1+1=2');
      expect(env.get('CONNECTION_STRING')).toBe('Server=localhost;Database=mydb;');
    });
  });

  describe('serializeEnvFile', () => {
    it('should serialize key-value pairs', () => {
      const env = new Map([
        ['DATABASE_URL', 'postgresql://localhost:5432/mydb'],
        ['API_KEY', 'secret-key'],
      ]);

      const content = serializeEnvFile(env, false);

      expect(content).toContain('DATABASE_URL=postgresql://localhost:5432/mydb');
      expect(content).toContain('API_KEY=secret-key');
    });

    it('should quote values with spaces', () => {
      const env = new Map([
        ['SYSTEM_PROMPT', 'You are a helpful assistant.'],
        ['SIMPLE_VALUE', 'no-spaces'],
      ]);

      const content = serializeEnvFile(env, false);

      expect(content).toContain('SYSTEM_PROMPT="You are a helpful assistant."');
      expect(content).toContain('SIMPLE_VALUE=no-spaces');
    });

    it('should include header comments when requested', () => {
      const env = new Map([['KEY', 'value']]);
      const content = serializeEnvFile(env, true);

      expect(content).toContain('# Generated environment configuration');
      expect(content).toContain('# Generated:');
    });

    it('should sort keys alphabetically', () => {
      const env = new Map([
        ['ZEBRA', 'last'],
        ['APPLE', 'first'],
        ['BANANA', 'second'],
      ]);

      const content = serializeEnvFile(env, false);
      const lines = content.split('\n').filter(l => l.length > 0);

      expect(lines[0]).toBe('APPLE=first');
      expect(lines[1]).toBe('BANANA=second');
      expect(lines[2]).toBe('ZEBRA=last');
    });
  });

  describe('mergeEnv', () => {
    it('should merge multiple env sources with correct precedence', () => {
      const base = new Map([
        ['PORT', '3000'],
        ['HOST', 'localhost'],
      ]);

      const overrides = new Map([
        ['PORT', '8080'],
      ]);

      const merged = mergeEnv(base, overrides);

      expect(merged.get('PORT')).toBe('8080'); // Overridden
      expect(merged.get('HOST')).toBe('localhost'); // Preserved from base
    });

    it('should handle multiple override layers', () => {
      const base = new Map([['A', '1'], ['B', '2'], ['C', '3']]);
      const override1 = new Map([['A', '10']]);
      const override2 = new Map([['B', '20']]);

      const merged = mergeEnv(base, override1, override2);

      expect(merged.get('A')).toBe('10');
      expect(merged.get('B')).toBe('20');
      expect(merged.get('C')).toBe('3');
    });

    it('should not mutate source maps', () => {
      const base = new Map([['KEY', 'original']]);
      const override = new Map([['KEY', 'modified']]);

      mergeEnv(base, override);

      expect(base.get('KEY')).toBe('original');
      expect(override.get('KEY')).toBe('modified');
    });
  });

  describe('filterEnvByPrefix', () => {
    it('should filter variables by prefix', () => {
      const env = new Map([
        ['DATABASE_URL', 'postgres://...'],
        ['DATABASE_PASSWORD', 'secret'],
        ['API_KEY', 'key'],
        ['API_SECRET', 'secret'],
      ]);

      const dbVars = filterEnvByPrefix(env, 'DATABASE_');

      expect(dbVars.size).toBe(2);
      expect(dbVars.has('DATABASE_URL')).toBe(true);
      expect(dbVars.has('DATABASE_PASSWORD')).toBe(true);
      expect(dbVars.has('API_KEY')).toBe(false);
    });

    it('should return empty map when no matches', () => {
      const env = new Map([
        ['API_KEY', 'key'],
        ['API_SECRET', 'secret'],
      ]);

      const dbVars = filterEnvByPrefix(env, 'DATABASE_');

      expect(dbVars.size).toBe(0);
    });
  });

  describe('validateRequiredVars', () => {
    it('should pass validation when all required vars present', () => {
      const env = new Map([
        ['DATABASE_URL', 'postgres://...'],
        ['API_KEY', 'key'],
      ]);

      const result = validateRequiredVars(env, ['DATABASE_URL', 'API_KEY']);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should fail validation when vars missing', () => {
      const env = new Map([
        ['DATABASE_URL', 'postgres://...'],
      ]);

      const result = validateRequiredVars(env, ['DATABASE_URL', 'API_KEY', 'SECRET']);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['API_KEY', 'SECRET']);
    });

    it('should treat empty values as missing', () => {
      const env = new Map([
        ['DATABASE_URL', 'postgres://...'],
        ['API_KEY', ''],
      ]);

      const result = validateRequiredVars(env, ['DATABASE_URL', 'API_KEY']);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['API_KEY']);
    });
  });

  describe('Round-trip (parse → serialize)', () => {
    it('should preserve values through parse-serialize cycle', () => {
      const original = `
DATABASE_URL=postgresql://localhost:5432/mydb
API_KEY=secret-key
SYSTEM_PROMPT="You are helpful."
`;

      const env = parseEnvFile(original);
      const serialized = serializeEnvFile(env, false);
      const reparsed = parseEnvFile(serialized);

      expect(reparsed.get('DATABASE_URL')).toBe('postgresql://localhost:5432/mydb');
      expect(reparsed.get('API_KEY')).toBe('secret-key');
      expect(reparsed.get('SYSTEM_PROMPT')).toBe('You are helpful.');
    });
  });
});
