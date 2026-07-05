/**
 * Unit tests for reflex-executor.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  executeReflex,
  validateReflexForExecution,
  estimateExecutionTime,
  getExecutionStatusDescription,
} from '../reflex-executor.js';
import type { Reflex } from '../../../types/reflex.js';
import type { InternalEventV2 } from '../../../types/events.js';

// Mock the tool executor
jest.mock('../tool-executor.js', () => ({
  executeTool: jest.fn(),
  ToolExecutionTimeoutError: class ToolExecutionTimeoutError extends Error {
    constructor(tool: string, timeout: number) {
      super(`Tool execution timeout after ${timeout}ms: ${tool}`);
      this.name = 'ToolExecutionTimeoutError';
    }
  },
  ToolExecutionError: class ToolExecutionError extends Error {
    public readonly statusCode?: number;
    public readonly toolResponse?: any;
    constructor(tool: string, message: string, statusCode?: number, toolResponse?: any) {
      super(`Tool execution failed for ${tool}: ${message}`);
      this.name = 'ToolExecutionError';
      this.statusCode = statusCode;
      this.toolResponse = toolResponse;
    }
  },
}));

describe('Reflex Executor', () => {
  const mockReflex: Reflex = {
    id: 'reflex-123',
    name: 'Test Reflex',
    active: true,
    priority: 1,
    match: {
      type: 'exact',
      pattern: '!fail',
      field: 'message.text',
    },
    action: {
      tool: 'obs.set_source_visibility',
      parameters: {
        sourceName: 'FailOverlay',
        visible: true,
        scene: '{{message.scene}}',
      },
      timeout: 3000,
    },
    candidateTemplate: '{{event.identity.user.displayName}} activated fail overlay!',
    createdAt: '2026-07-04T12:00:00Z',
    updatedAt: '2026-07-04T12:00:00Z',
  };

  const mockEvent: InternalEventV2 = {
    v: '2',
    type: 'twitch.chat.message',
    correlationId: 'test-123',
    ingress: {
      ingressAt: '2026-07-04T12:00:00Z',
      source: 'twitch-ingress',
      connector: 'twitch' as any,
      channel: '#testchannel',
    },
    message: {
      id: 'msg-123',
      role: 'user',
      text: '!fail',
    },
    identity: {
      user: {
        id: 'user-123',
        displayName: 'TestUser',
      },
      external: {
        id: 'twitch-user-123',
        platform: 'twitch',
        displayName: 'TestUser',
      },
    },
    routing: {
      stage: 'analysis',
      slip: [],
      history: [],
    },
    egress: {
      destination: 'twitch',
      connector: 'twitch',
    },
    timestamp: '2026-07-04T12:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeReflex', () => {
    it('should execute reflex successfully', async () => {
      const { executeTool } = require('../tool-executor.js');
      const mockToolResult = { success: true, visible: true };
      executeTool.mockResolvedValue(mockToolResult);

      const result = await executeReflex(mockReflex, mockEvent);

      expect(result.status).toBe('success');
      expect(result.result).toEqual(mockToolResult);
      expect(result.latency).toBeGreaterThan(0);
      expect(result.candidate).toBeDefined();
      expect(result.candidate?.text).toBe('TestUser activated fail overlay!');
    });

    it('should interpolate parameters correctly', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockResolvedValue({ success: true });

      await executeReflex(mockReflex, mockEvent);

      expect(executeTool).toHaveBeenCalledWith(
        'obs.set_source_visibility',
        {
          sourceName: 'FailOverlay',
          visible: true,
          scene: 'MainScene', // Interpolated from {{message.scene}}
        },
        expect.objectContaining({
          timeout: 3000,
        })
      );
    });

    it('should not generate candidate when template not provided', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockResolvedValue({ success: true });

      const reflexWithoutTemplate = { ...mockReflex, candidateTemplate: undefined };
      const result = await executeReflex(reflexWithoutTemplate, mockEvent);

      expect(result.status).toBe('success');
      expect(result.candidate).toBeUndefined();
    });

    it('should handle tool execution timeout', async () => {
      const { executeTool, ToolExecutionTimeoutError } = require('../tool-executor.js');
      executeTool.mockRejectedValue(new ToolExecutionTimeoutError('obs.set_source_visibility', 3000));

      const result = await executeReflex(mockReflex, mockEvent);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toContain('timeout');
      expect(result.latency).toBeGreaterThan(0);
    });

    it('should handle tool execution error', async () => {
      const { executeTool, ToolExecutionError } = require('../tool-executor.js');
      executeTool.mockRejectedValue(
        new ToolExecutionError('obs.set_source_visibility', 'Tool not found', 404)
      );

      const result = await executeReflex(mockReflex, mockEvent);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('HTTP_404');
      expect(result.error?.message).toContain('Tool not found');
    });

    it('should handle candidate building errors gracefully', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockResolvedValue({ success: true });

      // Template with invalid syntax (will fail validation but should not fail execution)
      const reflexWithBadTemplate = {
        ...mockReflex,
        candidateTemplate: '{{event.missing.deeply.nested.field}}',
      };

      const result = await executeReflex(reflexWithBadTemplate, mockEvent);

      // Execution should succeed even if candidate building has issues
      expect(result.status).toBe('success');
    });

    it('should use default timeout when not specified', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockResolvedValue({ success: true });

      const reflexWithoutTimeout = {
        ...mockReflex,
        action: {
          ...mockReflex.action,
          timeout: undefined,
        },
      };

      await executeReflex(reflexWithoutTimeout, mockEvent);

      expect(executeTool).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          timeout: 5000, // Default
        })
      );
    });

    it('should pass correlation ID to tool executor', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockResolvedValue({ success: true });

      await executeReflex(mockReflex, mockEvent, { correlationId: 'custom-123' });

      expect(executeTool).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          correlationId: 'custom-123',
        })
      );
    });

    it('should track execution latency', async () => {
      const { executeTool } = require('../tool-executor.js');
      executeTool.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ success: true }), 50);
        });
      });

      const result = await executeReflex(mockReflex, mockEvent);

      expect(result.latency).toBeGreaterThanOrEqual(50);
      expect(result.latency).toBeLessThan(200);
    });
  });

  describe('validateReflexForExecution', () => {
    it('should validate correct reflex', () => {
      const result = validateReflexForExecution(mockReflex);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing id', () => {
      const invalid = { ...mockReflex, id: '' };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing reflex ID');
    });

    it('should detect missing name', () => {
      const invalid = { ...mockReflex, name: '' };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing reflex name');
    });

    it('should detect missing action', () => {
      const invalid = { ...mockReflex, action: undefined as any };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing action configuration');
    });

    it('should detect missing tool name', () => {
      const invalid = {
        ...mockReflex,
        action: { ...mockReflex.action, tool: '' },
      };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing tool name in action');
    });

    it('should detect invalid timeout', () => {
      const invalid = {
        ...mockReflex,
        action: { ...mockReflex.action, timeout: 0 },
      };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Action timeout must be greater than 0');
    });

    it('should detect missing match configuration', () => {
      const invalid = { ...mockReflex, match: undefined as any };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing match configuration');
    });

    it('should detect missing match type', () => {
      const invalid = {
        ...mockReflex,
        match: { ...mockReflex.match, type: '' as any },
      };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing match type');
    });

    it('should detect multiple errors', () => {
      const invalid = {
        ...mockReflex,
        id: '',
        name: '',
        action: undefined as any,
      };
      const result = validateReflexForExecution(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(1);
    });
  });

  describe('estimateExecutionTime', () => {
    it('should estimate based on timeout', () => {
      const estimate = estimateExecutionTime(mockReflex);
      expect(estimate).toBe(3050); // 3000ms timeout + 50ms overhead
    });

    it('should use default timeout when not specified', () => {
      const reflexWithoutTimeout = {
        ...mockReflex,
        action: { ...mockReflex.action, timeout: undefined },
      };
      const estimate = estimateExecutionTime(reflexWithoutTimeout);
      expect(estimate).toBe(5050); // 5000ms default + 50ms overhead
    });
  });

  describe('getExecutionStatusDescription', () => {
    it('should describe successful execution', () => {
      const result = {
        status: 'success' as const,
        result: {},
        latency: 150,
      };
      const description = getExecutionStatusDescription(result);
      expect(description).toContain('successful');
      expect(description).toContain('150ms');
    });

    it('should describe successful execution with candidate', () => {
      const result = {
        status: 'success' as const,
        result: {},
        candidate: { text: 'Test' },
        latency: 150,
      };
      const description = getExecutionStatusDescription(result);
      expect(description).toContain('candidate generated');
    });

    it('should describe failed execution', () => {
      const result = {
        status: 'error' as const,
        error: { message: 'Tool not found' },
        latency: 50,
      };
      const description = getExecutionStatusDescription(result);
      expect(description).toContain('failed');
      expect(description).toContain('Tool not found');
      expect(description).toContain('50ms');
    });
  });
});
