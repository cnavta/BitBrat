import {
  hasEnvRef,
  interpolateEnvString,
  interpolateEnvArray,
  interpolateEnvRecord,
} from '../../src/common/env-interpolation';

describe('env-interpolation', () => {
  const env = {
    OPENAI_API_KEY: 'sk-secret-123',
    ENV: 'prod',
    EMPTY: '',
  } as Record<string, string | undefined>;

  describe('hasEnvRef', () => {
    it('detects references', () => {
      expect(hasEnvRef('${FOO}')).toBe(true);
      expect(hasEnvRef('prefix-${FOO}-suffix')).toBe(true);
    });
    it('returns false for literals and non-strings', () => {
      expect(hasEnvRef('plain literal')).toBe(false);
      expect(hasEnvRef(undefined as any)).toBe(false);
      expect(hasEnvRef(123 as any)).toBe(false);
    });
  });

  describe('interpolateEnvString', () => {
    it('returns literal strings unchanged (identity transform)', () => {
      const r = interpolateEnvString('no refs here', env);
      expect(r.value).toBe('no refs here');
      expect(r.refsUsed).toEqual([]);
      expect(r.unresolved).toEqual([]);
    });

    it('resolves a single reference', () => {
      const r = interpolateEnvString('${OPENAI_API_KEY}', env);
      expect(r.value).toBe('sk-secret-123');
      expect(r.refsUsed).toEqual(['OPENAI_API_KEY']);
      expect(r.unresolved).toEqual([]);
    });

    it('resolves multiple references and mixed literals', () => {
      const r = interpolateEnvString('env=${ENV};key=${OPENAI_API_KEY}', env);
      expect(r.value).toBe('env=prod;key=sk-secret-123');
      expect(r.refsUsed.sort()).toEqual(['ENV', 'OPENAI_API_KEY']);
      expect(r.unresolved).toEqual([]);
    });

    it('uses the default in ${VAR:-default} when unset', () => {
      const r = interpolateEnvString('${MISSING:-fallback}', env);
      expect(r.value).toBe('fallback');
      expect(r.refsUsed).toEqual(['MISSING']);
      expect(r.unresolved).toEqual([]);
    });

    it('uses the default when the var is empty', () => {
      const r = interpolateEnvString('${EMPTY:-fallback}', env);
      expect(r.value).toBe('fallback');
      expect(r.unresolved).toEqual([]);
    });

    it('substitutes empty string and records unresolved for a missing var with no default', () => {
      const r = interpolateEnvString('x=${MISSING_VAR}', env);
      expect(r.value).toBe('x=');
      expect(r.refsUsed).toEqual(['MISSING_VAR']);
      expect(r.unresolved).toEqual(['MISSING_VAR']);
    });
  });

  describe('interpolateEnvArray', () => {
    it('resolves each element and aggregates metadata', () => {
      const r = interpolateEnvArray(['--key', '${OPENAI_API_KEY}', '${MISSING}'], env);
      expect(r.value).toEqual(['--key', 'sk-secret-123', '']);
      expect(r.refsUsed.sort()).toEqual(['MISSING', 'OPENAI_API_KEY']);
      expect(r.unresolved).toEqual(['MISSING']);
    });
  });

  describe('interpolateEnvRecord', () => {
    it('resolves values, leaves keys unchanged', () => {
      const r = interpolateEnvRecord(
        { API_KEY: '${OPENAI_API_KEY}', MODE: '${ENV:-dev}', LITERAL: 'static' },
        env
      );
      expect(r.value).toEqual({ API_KEY: 'sk-secret-123', MODE: 'prod', LITERAL: 'static' });
      expect(r.refsUsed.sort()).toEqual(['ENV', 'OPENAI_API_KEY']);
      expect(r.unresolved).toEqual([]);
    });

    it('records unresolved names without throwing', () => {
      const r = interpolateEnvRecord({ TOKEN: '${MISSING_TOKEN}' }, env);
      expect(r.value).toEqual({ TOKEN: '' });
      expect(r.unresolved).toEqual(['MISSING_TOKEN']);
    });
  });
});
