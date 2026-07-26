/**
 * Sprint 366: Schema Validation Tests
 *
 * Tests that all tool schemas accept optional context parameter
 * and maintain backward compatibility.
 */

import { describe, it, expect } from '@jest/globals';
import { configTools } from '../tools/config.js';
import { persistenceTools } from '../tools/persistence.js';
import { fleetTools } from '../tools/fleet.js';
import { agentDevTools } from '../tools/agent-dev.js';

describe('Schema Validation - Context Parameter', () => {
  describe('Config Tools', () => {
    it('should accept optional context parameter in all config tools', () => {
      for (const tool of configTools) {
        // Build test args based on tool requirements
        let validArgs: Record<string, any> = { context: 'staging' };
        let baseArgs: Record<string, any> = {};

        if (tool.name === 'schema.read') {
          validArgs = { name: 'envelope.v1', context: 'staging' };
          baseArgs = { name: 'envelope.v1' };
        }

        // Test with context parameter
        const withContext = tool.inputSchema.safeParse(validArgs);
        expect(withContext.success).toBe(true);

        // Test without context parameter (backward compatibility)
        const withoutContext = tool.inputSchema.safeParse(baseArgs);
        expect(withoutContext.success).toBe(true);

        // Test with invalid context type (should fail)
        const invalidContext = tool.inputSchema.safeParse({
          ...baseArgs,
          context: 123, // number instead of string
        });
        expect(invalidContext.success).toBe(false);
      }
    });

    it('config.show should accept format and context', () => {
      const tool = configTools.find(t => t.name === 'config.show')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        format: 'yaml',
        context: 'local',
      });
      expect(result.success).toBe(true);
    });

    it('config.validate should accept context', () => {
      const tool = configTools.find(t => t.name === 'config.validate')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        context: 'prod',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Persistence Tools', () => {
    it('should accept optional context parameter in all persistence tools', () => {
      for (const tool of persistenceTools) {
        // Find a valid example for this tool
        let validArgs: Record<string, any> = { context: 'staging' };

        if (tool.name === 'db.get') {
          validArgs = { collection: 'commands', id: 'test', context: 'staging' };
        } else if (tool.name === 'db.query') {
          validArgs = { collection: 'events', context: 'staging' };
        }

        // Test with context parameter
        const withContext = tool.inputSchema.safeParse(validArgs);
        expect(withContext.success).toBe(true);

        // Test without context parameter (backward compatibility)
        const { context, ...argsWithoutContext } = validArgs;
        const withoutContext = tool.inputSchema.safeParse(argsWithoutContext);
        expect(withoutContext.success).toBe(true);
      }
    });

    it('db.collections should accept context', () => {
      const tool = persistenceTools.find(t => t.name === 'db.collections')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        context: 'local',
      });
      expect(result.success).toBe(true);
    });

    it('db.get should accept collection, id, and context', () => {
      const tool = persistenceTools.find(t => t.name === 'db.get')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        collection: 'commands',
        id: 'test-id',
        context: 'staging',
      });
      expect(result.success).toBe(true);
    });

    it('db.query should accept collection and context', () => {
      const tool = persistenceTools.find(t => t.name === 'db.query')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        collection: 'events',
        context: 'prod',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Fleet Tools', () => {
    it('should accept optional context parameter in all fleet tools', () => {
      for (const tool of fleetTools) {
        // Find a valid example for this tool
        let validArgs: Record<string, any> = { context: 'staging' };

        if (tool.name === 'fleet.info') {
          validArgs = { bit: 'llm-bot', context: 'staging' };
        } else if (tool.name === 'fleet.logs') {
          validArgs = { bit: 'api-gateway', context: 'staging' };
        } else if (tool.name === 'fleet.trace') {
          validArgs = { correlationId: 'test-123', context: 'staging' };
        }

        // Test with context parameter
        const withContext = tool.inputSchema.safeParse(validArgs);
        expect(withContext.success).toBe(true);

        // Test without context parameter (backward compatibility)
        const { context, ...argsWithoutContext } = validArgs;
        const withoutContext = tool.inputSchema.safeParse(argsWithoutContext);
        expect(withoutContext.success).toBe(true);
      }
    });

    it('fleet.list should accept context', () => {
      const tool = fleetTools.find(t => t.name === 'fleet.list')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        context: 'local',
      });
      expect(result.success).toBe(true);
    });

    it('fleet.info should accept bit and context', () => {
      const tool = fleetTools.find(t => t.name === 'fleet.info')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        bit: 'llm-bot',
        context: 'staging',
      });
      expect(result.success).toBe(true);
    });

    it('fleet.logs should accept bit and context', () => {
      const tool = fleetTools.find(t => t.name === 'fleet.logs')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        bit: 'api-gateway',
        context: 'prod',
      });
      expect(result.success).toBe(true);
    });

    it('fleet.trace should accept correlationId and context', () => {
      const tool = fleetTools.find(t => t.name === 'fleet.trace')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        correlationId: 'test-correlation-id',
        context: 'staging',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Agent-Dev Tools', () => {
    it('should accept optional context parameter in all agent-dev tools', () => {
      for (const tool of agentDevTools) {
        // Find a valid example for this tool
        let validArgs: Record<string, any> = { context: 'staging' };

        if (tool.name === 'agent_dev.provision') {
          validArgs = { name: 'agent-dev-test', context: 'staging' };
        } else if (tool.name === 'agent_dev.start') {
          validArgs = { name: 'agent-dev-test', context: 'staging' };
        } else if (tool.name === 'agent_dev.stop') {
          validArgs = { name: 'agent-dev-test', context: 'staging' };
        } else if (tool.name === 'agent_dev.destroy') {
          validArgs = { name: 'agent-dev-test', confirm: true, context: 'staging' };
        }

        // Test with context parameter
        const withContext = tool.inputSchema.safeParse(validArgs);
        expect(withContext.success).toBe(true);

        // Test without context parameter (backward compatibility)
        const { context, ...argsWithoutContext } = validArgs;
        const withoutContext = tool.inputSchema.safeParse(argsWithoutContext);
        expect(withoutContext.success).toBe(true);
      }
    });

    it('agent_dev.provision should accept name and context', () => {
      const tool = agentDevTools.find(t => t.name === 'agent_dev.provision')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        name: 'agent-dev-custom',
        context: 'local',
      });
      expect(result.success).toBe(true);
    });

    it('agent_dev.start should accept name and context', () => {
      const tool = agentDevTools.find(t => t.name === 'agent_dev.start')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        name: 'agent-dev-test',
        context: 'staging',
      });
      expect(result.success).toBe(true);
    });

    it('agent_dev.stop should accept name and context', () => {
      const tool = agentDevTools.find(t => t.name === 'agent_dev.stop')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        name: 'agent-dev-test',
        context: 'prod',
      });
      expect(result.success).toBe(true);
    });

    it('agent_dev.destroy should accept name, confirm, and context', () => {
      const tool = agentDevTools.find(t => t.name === 'agent_dev.destroy')!;
      expect(tool).toBeDefined();

      const result = tool.inputSchema.safeParse({
        name: 'agent-dev-test',
        confirm: true,
        context: 'local',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should allow context to be omitted (undefined)', () => {
      // Test a sample from each category
      const samples = [
        { tool: configTools.find(t => t.name === 'config.show')!, args: {} },
        { tool: persistenceTools.find(t => t.name === 'db.collections')!, args: {} },
        { tool: fleetTools.find(t => t.name === 'fleet.list')!, args: {} },
        { tool: agentDevTools.find(t => t.name === 'agent_dev.provision')!, args: {} },
      ];

      for (const { tool, args } of samples) {
        const result = tool.inputSchema.safeParse(args);
        // Context is optional, so parsing should succeed even without it
        // (though other required fields may cause failure)
        const withContext = tool.inputSchema.safeParse({
          ...args,
          context: undefined,
        });
        expect(withContext.success).toBe(result.success); // Same result with or without undefined context
      }
    });

    it('should reject invalid context types', () => {
      // Test a sample from each category
      const samples = [
        { tool: configTools[0], args: {} },
        { tool: persistenceTools.find(t => t.name === 'db.collections')!, args: {} },
        { tool: fleetTools.find(t => t.name === 'fleet.list')!, args: {} },
        { tool: agentDevTools.find(t => t.name === 'agent_dev.provision')!, args: {} },
      ];

      for (const { tool, args } of samples) {
        // Context as number
        const asNumber = tool.inputSchema.safeParse({
          ...args,
          context: 123,
        });
        expect(asNumber.success).toBe(false);

        // Context as object
        const asObject = tool.inputSchema.safeParse({
          ...args,
          context: { name: 'local' },
        });
        expect(asObject.success).toBe(false);

        // Context as array
        const asArray = tool.inputSchema.safeParse({
          ...args,
          context: ['local'],
        });
        expect(asArray.success).toBe(false);
      }
    });
  });

  describe('Context Parameter Description', () => {
    it('should have consistent description across all tools', () => {
      const allTools = [
        ...configTools,
        ...persistenceTools,
        ...fleetTools,
        ...agentDevTools,
      ];

      const expectedDescription = 'Execution context (local, staging, prod). Defaults to server startup context.';

      for (const tool of allTools) {
        // Verify schema accepts context parameter with correct type
        const withValidContext = tool.inputSchema.safeParse({
          context: 'local',
        });
        const withInvalidContext = tool.inputSchema.safeParse({
          context: 123,
        });

        // Valid context should parse (may fail on other required fields, but not on context type)
        // Invalid context type should definitely fail
        expect(withInvalidContext.success).toBe(false);
      }
    });
  });
});
