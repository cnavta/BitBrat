/**
 * Event Context Tests
 *
 * Comprehensive test suite for AsyncLocalStorage-based event context propagation.
 * These tests validate context isolation, propagation through async operations,
 * and proper behavior in edge cases.
 */

import {
  runWithEventContext,
  getEventContext,
  getContextField,
  updateEventContext,
  hasEventContext,
  type EventContext,
} from './event-context';

describe('EventContext', () => {
  describe('runWithEventContext', () => {
    it('should propagate context through async operations', async () => {
      const testContext: EventContext = { correlationId: 'test-123' };

      await runWithEventContext(testContext, async () => {
        const ctx = getEventContext();
        expect(ctx).toBeDefined();
        expect(ctx?.correlationId).toBe('test-123');
      });
    });

    it('should propagate context through nested async calls', async () => {
      const testContext: EventContext = { correlationId: 'nested-456' };

      await runWithEventContext(testContext, async () => {
        // First level
        expect(getEventContext()?.correlationId).toBe('nested-456');

        await nestedAsyncFunction1();

        async function nestedAsyncFunction1() {
          // Second level
          expect(getEventContext()?.correlationId).toBe('nested-456');

          await nestedAsyncFunction2();
        }

        async function nestedAsyncFunction2() {
          // Third level
          expect(getEventContext()?.correlationId).toBe('nested-456');
        }
      });
    });

    it('should propagate context through Promise chains', async () => {
      const testContext: EventContext = { correlationId: 'promise-789' };

      await runWithEventContext(testContext, () => {
        return Promise.resolve()
          .then(() => {
            expect(getEventContext()?.correlationId).toBe('promise-789');
            return Promise.resolve();
          })
          .then(() => {
            expect(getEventContext()?.correlationId).toBe('promise-789');
          });
      });
    });

    it('should propagate context through setTimeout', async () => {
      const testContext: EventContext = { correlationId: 'timeout-abc' };

      await runWithEventContext(testContext, async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(getEventContext()?.correlationId).toBe('timeout-abc');
            resolve();
          }, 10);
        });
      });
    });

    it('should support synchronous functions', () => {
      const testContext: EventContext = { correlationId: 'sync-def' };

      const result = runWithEventContext(testContext, () => {
        expect(getEventContext()?.correlationId).toBe('sync-def');
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should support all EventContext fields', async () => {
      const testContext: EventContext = {
        correlationId: 'full-context',
        traceId: 'trace-123',
        sessionId: 'session-456',
        userId: 'user-789',
        requestId: 'request-abc',
        stage: 'analysis',
        customField: 'custom-value',
      };

      await runWithEventContext(testContext, async () => {
        const ctx = getEventContext();
        expect(ctx?.correlationId).toBe('full-context');
        expect(ctx?.traceId).toBe('trace-123');
        expect(ctx?.sessionId).toBe('session-456');
        expect(ctx?.userId).toBe('user-789');
        expect(ctx?.requestId).toBe('request-abc');
        expect(ctx?.stage).toBe('analysis');
        expect(ctx?.customField).toBe('custom-value');
      });
    });
  });

  describe('getEventContext', () => {
    it('should return undefined outside of context', () => {
      const ctx = getEventContext();
      expect(ctx).toBeUndefined();
    });

    it('should return context inside runWithEventContext', async () => {
      await runWithEventContext({ correlationId: 'get-test' }, async () => {
        const ctx = getEventContext();
        expect(ctx).toBeDefined();
        expect(ctx?.correlationId).toBe('get-test');
      });
    });

    it('should return undefined after exiting context', async () => {
      await runWithEventContext({ correlationId: 'exit-test' }, async () => {
        expect(getEventContext()).toBeDefined();
      });

      // Outside context now
      expect(getEventContext()).toBeUndefined();
    });
  });

  describe('getContextField', () => {
    it('should return specific field from context', async () => {
      await runWithEventContext(
        { correlationId: 'field-123', userId: 'user-456' },
        async () => {
          expect(getContextField('correlationId')).toBe('field-123');
          expect(getContextField('userId')).toBe('user-456');
        }
      );
    });

    it('should return undefined for missing field', async () => {
      await runWithEventContext({ correlationId: 'missing-test' }, async () => {
        expect(getContextField('sessionId')).toBeUndefined();
      });
    });

    it('should return undefined outside context', () => {
      expect(getContextField('correlationId')).toBeUndefined();
    });
  });

  describe('updateEventContext', () => {
    it('should merge updates with existing context', async () => {
      await runWithEventContext({ correlationId: 'update-123' }, async () => {
        // Initial context
        expect(getEventContext()?.correlationId).toBe('update-123');
        expect(getEventContext()?.userId).toBeUndefined();

        // Update context
        updateEventContext({ userId: 'user-789' });

        // Both fields should be present
        expect(getEventContext()?.correlationId).toBe('update-123');
        expect(getEventContext()?.userId).toBe('user-789');
      });
    });

    it('should allow multiple updates', async () => {
      await runWithEventContext({ correlationId: 'multi-update' }, async () => {
        updateEventContext({ sessionId: 'session-1' });
        updateEventContext({ userId: 'user-1' });
        updateEventContext({ stage: 'analysis' });

        const ctx = getEventContext();
        expect(ctx?.correlationId).toBe('multi-update');
        expect(ctx?.sessionId).toBe('session-1');
        expect(ctx?.userId).toBe('user-1');
        expect(ctx?.stage).toBe('analysis');
      });
    });

    it('should overwrite existing fields', async () => {
      await runWithEventContext({ stage: 'attention' }, async () => {
        expect(getEventContext()?.stage).toBe('attention');

        updateEventContext({ stage: 'analysis' });
        expect(getEventContext()?.stage).toBe('analysis');

        updateEventContext({ stage: 'reaction' });
        expect(getEventContext()?.stage).toBe('reaction');
      });
    });

    it('should do nothing outside context', () => {
      // Should not throw
      updateEventContext({ correlationId: 'no-context' });

      // Context still undefined
      expect(getEventContext()).toBeUndefined();
    });

    it('should update context in nested async calls', async () => {
      await runWithEventContext({ correlationId: 'nested-update' }, async () => {
        async function deepFunction() {
          updateEventContext({ userId: 'deep-user' });
        }

        await deepFunction();

        expect(getEventContext()?.userId).toBe('deep-user');
      });
    });
  });

  describe('hasEventContext', () => {
    it('should return false outside context', () => {
      expect(hasEventContext()).toBe(false);
    });

    it('should return true inside context', async () => {
      await runWithEventContext({ correlationId: 'has-test' }, async () => {
        expect(hasEventContext()).toBe(true);
      });
    });

    it('should return false after exiting context', async () => {
      await runWithEventContext({ correlationId: 'exit-has' }, async () => {
        expect(hasEventContext()).toBe(true);
      });

      expect(hasEventContext()).toBe(false);
    });
  });

  describe('Context Isolation', () => {
    it('should isolate contexts between concurrent operations', async () => {
      const results: string[] = [];

      // Run two concurrent operations with different contexts
      await Promise.all([
        runWithEventContext({ correlationId: 'concurrent-1' }, async () => {
          await delay(10);
          results.push(getEventContext()?.correlationId || 'none');
        }),
        runWithEventContext({ correlationId: 'concurrent-2' }, async () => {
          await delay(5);
          results.push(getEventContext()?.correlationId || 'none');
        }),
      ]);

      // Both operations should have maintained their own context
      expect(results).toContain('concurrent-1');
      expect(results).toContain('concurrent-2');
      expect(results.length).toBe(2);
    });

    it('should not leak context between sequential operations', async () => {
      await runWithEventContext({ correlationId: 'seq-1' }, async () => {
        expect(getEventContext()?.correlationId).toBe('seq-1');
      });

      await runWithEventContext({ correlationId: 'seq-2' }, async () => {
        expect(getEventContext()?.correlationId).toBe('seq-2');
        expect(getEventContext()?.correlationId).not.toBe('seq-1');
      });
    });

    it('should isolate nested contexts', async () => {
      await runWithEventContext({ correlationId: 'outer' }, async () => {
        expect(getEventContext()?.correlationId).toBe('outer');

        // Nested context with different correlationId
        await runWithEventContext({ correlationId: 'inner' }, async () => {
          expect(getEventContext()?.correlationId).toBe('inner');
        });

        // Back to outer context
        expect(getEventContext()?.correlationId).toBe('outer');
      });
    });
  });

  describe('Error Handling', () => {
    it('should maintain context when errors are thrown', async () => {
      await expect(
        runWithEventContext({ correlationId: 'error-test' }, async () => {
          expect(getEventContext()?.correlationId).toBe('error-test');
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Context should be cleaned up after error
      expect(getEventContext()).toBeUndefined();
    });

    it('should propagate errors through context', async () => {
      const errorToThrow = new Error('Propagated error');

      await expect(
        runWithEventContext({ correlationId: 'propagate' }, async () => {
          async function throwError() {
            throw errorToThrow;
          }

          await throwError();
        })
      ).rejects.toThrow('Propagated error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty context object', async () => {
      await runWithEventContext({}, async () => {
        const ctx = getEventContext();
        expect(ctx).toBeDefined();
        expect(ctx?.correlationId).toBeUndefined();
      });
    });

    it('should handle null/undefined values in context', async () => {
      await runWithEventContext(
        { correlationId: undefined, userId: null as any },
        async () => {
          const ctx = getEventContext();
          expect(ctx).toBeDefined();
          expect('correlationId' in (ctx || {})).toBe(true);
          expect('userId' in (ctx || {})).toBe(true);
        }
      );
    });

    it('should handle rapid context creation and destruction', async () => {
      const iterations = 100;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < iterations; i++) {
        const promise = runWithEventContext({ correlationId: `rapid-${i}` }, async () => {
          await delay(1);
          expect(getEventContext()?.correlationId).toBe(`rapid-${i}`);
        });
        promises.push(Promise.resolve(promise));
      }

      await Promise.all(promises);
      expect(getEventContext()).toBeUndefined();
    });
  });
});

/**
 * Helper function to introduce async delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
