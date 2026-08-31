/**
 * Tests for template interpolation with captures (Sprint 34)
 * 
 * Tests the new capture-based interpolation functions.
 */

import {
  coerceType,
  interpolateCapturesInTemplate,
  interpolateCapturesInParameter,
  interpolateCapturesInParameters,
} from '../template-interpolator';
import { MatchCaptures } from '../../../types/reflex';

describe('Template Interpolator - Captures', () => {
  const sampleCaptures: MatchCaptures = {
    0: '!bid 50',
    1: '50',
    2: undefined,
  };

  const multiCaptures: MatchCaptures = {
    0: '!timer 30 Break time',
    1: '30',
    2: 'Break time',
  };

  describe('coerceType()', () => {
    test('should coerce numeric strings to numbers', () => {
      expect(coerceType('50')).toBe(50);
      expect(coerceType('3.14')).toBe(3.14);
      expect(coerceType('-100')).toBe(-100);
      expect(coerceType('0')).toBe(0);
    });

    test('should coerce hex numbers', () => {
      expect(coerceType('0x10')).toBe(16);
      expect(coerceType('0xFF')).toBe(255);
    });

    test('should coerce scientific notation', () => {
      expect(coerceType('1e3')).toBe(1000);
      expect(coerceType('2.5e2')).toBe(250);
      expect(coerceType('1e-3')).toBe(0.001);
    });

    test('should coerce boolean strings', () => {
      expect(coerceType('true')).toBe(true);
      expect(coerceType('false')).toBe(false);
      expect(coerceType('TRUE')).toBe(true);
      expect(coerceType('FALSE')).toBe(false);
      expect(coerceType('True')).toBe(true);
    });

    test('should NOT coerce mixed strings', () => {
      expect(coerceType('50px')).toBe('50px');
      expect(coerceType('Amount: 100')).toBe('Amount: 100');
      expect(coerceType('hello')).toBe('hello');
      expect(coerceType('')).toBe('');
    });

    test('should handle edge cases', () => {
      expect(coerceType('Infinity')).toBe(Infinity);
      expect(coerceType('-Infinity')).toBe(-Infinity);
      expect(coerceType('NaN')).toBe('NaN'); // NaN string stays string
    });
  });

  describe('interpolateCapturesInTemplate()', () => {
    test('should replace ${N} placeholders with captures', () => {
      const result = interpolateCapturesInTemplate(
        'Bid placed: ${1}',
        sampleCaptures
      );

      expect(result).toBe('Bid placed: 50');
    });

    test('should replace $N placeholders with captures', () => {
      const result = interpolateCapturesInTemplate(
        'Amount: $1',
        sampleCaptures
      );

      expect(result).toBe('Amount: 50');
    });

    test('should replace multiple captures', () => {
      const result = interpolateCapturesInTemplate(
        'Timer: ${1}s - ${2}',
        multiCaptures
      );

      expect(result).toBe('Timer: 30s - Break time');
    });

    test('should handle mixed ${N} and $N syntax', () => {
      const result = interpolateCapturesInTemplate(
        '$1 and ${2}',
        multiCaptures
      );

      expect(result).toBe('30 and Break time');
    });

    test('should keep placeholder if capture missing', () => {
      const result = interpolateCapturesInTemplate(
        'Value: ${5}',
        sampleCaptures
      );

      expect(result).toBe('Value: ${5}'); // Graceful degradation
    });

    test('should handle full match ${0}', () => {
      const result = interpolateCapturesInTemplate(
        'Full: ${0}',
        sampleCaptures
      );

      expect(result).toBe('Full: !bid 50');
    });

    test('should return unchanged if no captures provided', () => {
      const result = interpolateCapturesInTemplate('Value: ${1}', undefined);

      expect(result).toBe('Value: ${1}');
    });

    test('should handle empty template', () => {
      const result = interpolateCapturesInTemplate('', sampleCaptures);

      expect(result).toBe('');
    });
  });

  describe('interpolateCapturesInParameter()', () => {
    test('should coerce pure ${N} placeholder to number', () => {
      const result = interpolateCapturesInParameter('${1}', sampleCaptures);

      expect(result).toBe(50); // Coerced to number
      expect(typeof result).toBe('number');
    });

    test('should coerce pure $N placeholder to number', () => {
      const result = interpolateCapturesInParameter('$1', sampleCaptures);

      expect(result).toBe(50);
      expect(typeof result).toBe('number');
    });

    test('should NOT coerce mixed string with ${N}', () => {
      const result = interpolateCapturesInParameter(
        'Amount: ${1}',
        sampleCaptures
      );

      expect(result).toBe('Amount: 50'); // String
      expect(typeof result).toBe('string');
    });

    test('should coerce boolean capture', () => {
      const boolCaptures: MatchCaptures = { 0: 'full', 1: 'true' };
      const result = interpolateCapturesInParameter('${1}', boolCaptures);

      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    test('should pass through non-string values unchanged', () => {
      expect(interpolateCapturesInParameter(42, sampleCaptures)).toBe(42);
      expect(interpolateCapturesInParameter(true, sampleCaptures)).toBe(true);
      expect(interpolateCapturesInParameter(null, sampleCaptures)).toBe(null);
    });

    test('should keep placeholder for missing capture', () => {
      const result = interpolateCapturesInParameter('${10}', sampleCaptures);

      expect(result).toBe('${10}');
    });

    test('should handle no captures provided', () => {
      const result = interpolateCapturesInParameter('${1}', undefined);

      expect(result).toBe('${1}');
    });
  });

  describe('interpolateCapturesInParameters()', () => {
    test('should interpolate simple parameter object', () => {
      const params = {
        amount: '${1}',
        message: 'Bid: ${1}',
      };

      const result = interpolateCapturesInParameters(params, sampleCaptures);

      expect(result.amount).toBe(50); // Coerced
      expect(result.message).toBe('Bid: 50'); // String
    });

    test('should interpolate nested objects', () => {
      const params = {
        config: {
          value: '${1}',
          label: 'Value: ${1}',
        },
      };

      const result = interpolateCapturesInParameters(params, sampleCaptures);

      expect(result.config.value).toBe(50);
      expect(result.config.label).toBe('Value: 50');
    });

    test('should interpolate arrays', () => {
      const params = {
        values: ['${1}', '${2}', 'static'],
      };

      const result = interpolateCapturesInParameters(params, multiCaptures);

      expect(result.values[0]).toBe(30);
      expect(result.values[1]).toBe('Break time');
      expect(result.values[2]).toBe('static');
    });

    test('should preserve non-string values', () => {
      const params = {
        number: 42,
        boolean: true,
        nullValue: null,
        string: '${1}',
      };

      const result = interpolateCapturesInParameters(params, sampleCaptures);

      expect(result.number).toBe(42);
      expect(result.boolean).toBe(true);
      expect(result.nullValue).toBe(null);
      expect(result.string).toBe(50); // Coerced
    });

    test('should handle empty object', () => {
      const result = interpolateCapturesInParameters({}, sampleCaptures);

      expect(result).toEqual({});
    });

    test('should return unchanged if no captures', () => {
      const params = { value: '${1}' };
      const result = interpolateCapturesInParameters(params, undefined);

      expect(result).toEqual(params);
    });

    test('should handle complex nested structure', () => {
      const params = {
        bid: {
          amount: '${1}',
          currency: 'USD',
          metadata: {
            description: 'Bid of ${1}',
            tags: ['${1}', 'auction'],
          },
        },
      };

      const result = interpolateCapturesInParameters(params, sampleCaptures);

      expect(result.bid.amount).toBe(50);
      expect(result.bid.currency).toBe('USD');
      expect(result.bid.metadata.description).toBe('Bid of 50');
      expect(result.bid.metadata.tags[0]).toBe(50);
      expect(result.bid.metadata.tags[1]).toBe('auction');
    });
  });

  describe('Type coercion in realistic scenarios', () => {
    test('!bid command - amount coercion', () => {
      const bidCaptures: MatchCaptures = { 0: '!bid 50', 1: '50' };
      const params = { amount: '${1}' };

      const result = interpolateCapturesInParameters(params, bidCaptures);

      expect(result.amount).toBe(50);
      expect(typeof result.amount).toBe('number');
    });

    test('!timer command - duration coercion', () => {
      const timerCaptures: MatchCaptures = {
        0: '!timer 30 Break',
        1: '30',
        2: 'Break',
      };
      const params = {
        duration: '${1}',
        message: '${2}',
      };

      const result = interpolateCapturesInParameters(params, timerCaptures);

      expect(result.duration).toBe(30);
      expect(result.message).toBe('Break');
    });

    test('!volume command - percentage coercion', () => {
      const volumeCaptures: MatchCaptures = { 0: '!volume 75', 1: '75' };
      const params = {
        level: '${1}',
        displayText: 'Volume: ${1}%',
      };

      const result = interpolateCapturesInParameters(params, volumeCaptures);

      expect(result.level).toBe(75);
      expect(result.displayText).toBe('Volume: 75%');
    });
  });

  describe('Performance', () => {
    test('should complete template interpolation within 3ms', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        interpolateCapturesInTemplate('Value: ${1}', sampleCaptures);
      }

      const avgTime = (performance.now() - startTime) / 1000;
      expect(avgTime).toBeLessThan(3);
    });

    test('should complete parameter interpolation within 3ms', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        interpolateCapturesInParameter('${1}', sampleCaptures);
      }

      const avgTime = (performance.now() - startTime) / 1000;
      expect(avgTime).toBeLessThan(3);
    });
  });
});
