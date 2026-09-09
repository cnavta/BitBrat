/**
 * Integration tests for reflex command arguments (Sprint 34)
 * 
 * Tests the complete flow from pattern matching through execution
 * with capture extraction and interpolation.
 */

import { matchReflexWithCaptures } from '../reflex-matcher';
import { executeReflex } from '../reflex-executor';
import { buildParameters } from '../parameter-builder';
import { buildCandidates } from '../candidate-builder';
import { Reflex } from '../../../types/reflex';
import { InternalEventV2 } from '../../../types/events';

// Mock tool executor to avoid actual MCP calls
jest.mock('../tool-executor', () => ({
  executeTool: jest.fn().mockResolvedValue({ success: true }),
  ToolExecutionTimeoutError: class extends Error {},
  ToolExecutionError: class extends Error {},
}));

describe('Reflex Captures - Integration Tests', () => {
  const createMockEvent = (messageText: string): InternalEventV2 => ({
    type: 'chat.message.v1',
    correlationId: 'test-123',
    ingress: {
      platform: 'twitch',
      channel: '#test',
      ingressAt: new Date().toISOString(),
    },
    message: {
      text: messageText,
      timestamp: new Date().toISOString(),
    },
    identity: {
      external: {
        id: 'user123',
        platform: 'twitch',
        displayName: 'TestUser',
        roles: [],
      },
    },
  } as any);

  describe('End-to-end flow: !bid command', () => {
    const bidReflex: Reflex = {
      id: 'bid-reflex',
      name: 'Bid Command',
      active: true,
      priority: 10,
      match: {
        type: 'regex',
        pattern: '^!bid (\\d+)$',
        field: 'message.text',
      },
      action: {
        tool: 'create_bid',
        parameters: {
          amount: '${1}', // Should be coerced to number
          user: '{{identity.external.displayName}}',
        },
      },
      candidateTemplate: 'Bid of ${1} placed by {{event.identity.external.displayName}}!',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    test('should match, extract captures, and execute with typed parameters', async () => {
      const event = createMockEvent('!bid 50');

      // Step 1: Match with captures
      const matchResult = matchReflexWithCaptures(event, bidReflex);

      expect(matchResult.matched).toBe(true);
      expect(matchResult.captures![0]).toBe('!bid 50');
      expect(matchResult.captures![1]).toBe('50');

      // Step 2: Execute with captures
      const execResult = await executeReflex(bidReflex, event, {
        captures: matchResult.captures,
      });

      expect(execResult.status).toBe('success');
      expect(execResult.captures).toBeDefined();
      expect(execResult.candidates).toHaveLength(1);
      expect(execResult.candidates![0].text).toBe('Bid of 50 placed by TestUser!');
    });

    test('should coerce amount parameter to number', () => {
      const event = createMockEvent('!bid 100');
      const matchResult = matchReflexWithCaptures(event, bidReflex);

      const params = buildParameters(
        bidReflex.action!.parameters,
        event,
        matchResult.captures
      );

      expect(params.amount).toBe(100); // Number, not string!
      expect(typeof params.amount).toBe('number');
      expect(params.user).toBe('TestUser');
    });
  });

  describe('End-to-end flow: !timer command', () => {
    const timerReflex: Reflex = {
      id: 'timer-reflex',
      name: 'Timer Command',
      active: true,
      priority: 10,
      match: {
        type: 'regex',
        pattern: '^!timer (\\d+) (.+)$',
        field: 'message.text',
      },
      action: {
        tool: 'create_timer',
        parameters: {
          duration: '${1}',
          message: '${2}',
          user: '{{identity.external.displayName}}',
        },
      },
      candidateTemplate: 'Timer set: ${1}s - ${2}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    test('should extract and use multiple captures', async () => {
      const event = createMockEvent('!timer 30 Take a break');
      const matchResult = matchReflexWithCaptures(event, timerReflex);

      expect(matchResult.matched).toBe(true);
      expect(matchResult.captures![1]).toBe('30');
      expect(matchResult.captures![2]).toBe('Take a break');

      const params = buildParameters(
        timerReflex.action!.parameters,
        event,
        matchResult.captures
      );

      expect(params.duration).toBe(30); // Coerced to number
      expect(params.message).toBe('Take a break'); // String
      expect(params.user).toBe('TestUser');
    });

    test('should generate candidate with multiple captures', () => {
      const event = createMockEvent('!timer 30 Take a break');
      const matchResult = matchReflexWithCaptures(event, timerReflex);

      const candidates = buildCandidates(
        timerReflex.candidateTemplate!,
        timerReflex,
        event,
        {},
        matchResult.captures
      );

      expect(candidates[0].text).toBe('Timer set: 30s - Take a break');
    });
  });

  describe('Backward compatibility', () => {
    test('should work without captures (existing behavior)', async () => {
      const simpleReflex: Reflex = {
        id: 'simple',
        name: 'Simple',
        active: true,
        priority: 10,
        match: {
          type: 'exact',
          pattern: '!ping',
          field: 'message.text',
        },
        candidateTemplate: 'Pong from {{event.identity.external.displayName}}!',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const event = createMockEvent('!ping');

      // Old way: no captures
      const execResult = await executeReflex(simpleReflex, event);

      expect(execResult.status).toBe('success');
      expect(execResult.candidates).toHaveLength(1);
      expect(execResult.candidates![0].text).toBe('Pong from TestUser!');
    });

    test('buildParameters should work without captures', () => {
      const params = buildParameters(
        { value: '{{message.text}}' },
        createMockEvent('test')
      );

      expect(params.value).toBe('test');
    });

    test('buildCandidates should work without captures', () => {
      const candidates = buildCandidates(
        'Message: {{event.message.text}}',
        {} as Reflex,
        createMockEvent('hello'),
        {}
      );

      expect(candidates[0].text).toBe('Message: hello');
    });
  });

  describe('Mixed interpolation scenarios', () => {
    test('should handle both captures and event fields', () => {
      const event = createMockEvent('!bid 75');
      const captures = { 0: '!bid 75', 1: '75' };

      const params = buildParameters(
        {
          amount: '${1}',
          user: '{{identity.external.displayName}}',
          channel: '{{ingress.channel}}',
        },
        event,
        captures
      );

      expect(params.amount).toBe(75);
      expect(params.user).toBe('TestUser');
      expect(params.channel).toBe('#test');
    });

    test('should handle captures in candidate templates with event fields', () => {
      const event = createMockEvent('!bid 100');
      const captures = { 0: '!bid 100', 1: '100' };

      const candidates = buildCandidates(
        'Bid: ${1} by {{event.identity.external.displayName}} in {{event.ingress.channel}}',
        {} as Reflex,
        event,
        {},
        captures
      );

      expect(candidates[0].text).toBe('Bid: 100 by TestUser in #test');
    });
  });

  describe('Edge cases in integration', () => {
    test('should handle reference to non-existent capture index', () => {
      const reflex: Reflex = {
        id: 'volume',
        name: 'Volume',
        active: true,
        priority: 10,
        match: {
          type: 'regex',
          pattern: '^!volume (on|off)$',
          field: 'message.text',
        },
        action: {
          tool: 'volume',
          parameters: {
            state: '${1}',
            extra: '${5}', // Non-existent capture index
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const event = createMockEvent('!volume on');
      const matchResult = matchReflexWithCaptures(event, reflex);

      expect(matchResult.matched).toBe(true);
      expect(matchResult.captures![1]).toBe('on');
      expect(matchResult.captures![5]).toBeUndefined();

      const params = buildParameters(
        reflex.action!.parameters,
        event,
        matchResult.captures
      );

      // Existing capture interpolated
      expect(params.state).toBe('on');
      // Missing capture keeps placeholder
      expect(params.extra).toBe('${5}');
    });

    test('should handle non-matching reflex gracefully', async () => {
      const reflex: Reflex = {
        id: 'bid',
        name: 'Bid',
        active: true,
        priority: 10,
        match: {
          type: 'regex',
          pattern: '^!bid (\\d+)$',
          field: 'message.text',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const event = createMockEvent('hello world');
      const matchResult = matchReflexWithCaptures(event, reflex);

      expect(matchResult.matched).toBe(false);
      expect(matchResult.captures).toBeUndefined();
    });
  });

  describe('Performance', () => {
    test('complete flow should execute within 150ms', async () => {
      const reflex: Reflex = {
        id: 'perf-test',
        name: 'Performance Test',
        active: true,
        priority: 10,
        match: {
          type: 'regex',
          pattern: '^!test (\\d+)$',
          field: 'message.text',
        },
        action: {
          tool: 'test_tool',
          parameters: { value: '${1}' },
        },
        candidateTemplate: 'Test: ${1}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const event = createMockEvent('!test 42');
      const startTime = Date.now();

      const matchResult = matchReflexWithCaptures(event, reflex);
      await executeReflex(reflex, event, { captures: matchResult.captures });

      const latency = Date.now() - startTime;
      expect(latency).toBeLessThan(150);
    });
  });
});
