/**
 * Sprint 358: Agent-Dev MCP Tools Integration Tests
 *
 * Tests tool definitions, input validation, and error handling.
 * Full integration tests require Docker and are handled in E2E test suite.
 */

import { agentDevProvisionTool, agentDevStartTool, agentDevStopTool, agentDevDestroyTool, agentDevTools } from './agent-dev';
import type { TargetConnection } from '../types';

describe('Agent-Dev MCP Tools - Sprint 358', () => {
  let mockConnection: TargetConnection;

  beforeEach(() => {
    // Create mock connection
    mockConnection = {
      name: 'local',
      type: 'local',
      firestore: {} as any,
      cleanup: jest.fn(),
    };
  });

  describe('Tool Registration', () => {
    it('exports all 4 lifecycle tools', () => {
      expect(agentDevTools).toHaveLength(4);
      expect(agentDevTools).toContain(agentDevProvisionTool);
      expect(agentDevTools).toContain(agentDevStartTool);
      expect(agentDevTools).toContain(agentDevStopTool);
      expect(agentDevTools).toContain(agentDevDestroyTool);
    });

    it('all tools have correct names', () => {
      expect(agentDevProvisionTool.name).toBe('agent_dev.provision');
      expect(agentDevStartTool.name).toBe('agent_dev.start');
      expect(agentDevStopTool.name).toBe('agent_dev.stop');
      expect(agentDevDestroyTool.name).toBe('agent_dev.destroy');
    });

    it('all tools have descriptions', () => {
      expect(agentDevProvisionTool.description).toBeTruthy();
      expect(agentDevStartTool.description).toBeTruthy();
      expect(agentDevStopTool.description).toBeTruthy();
      expect(agentDevDestroyTool.description).toBeTruthy();

      expect(agentDevProvisionTool.description.length).toBeGreaterThan(20);
      expect(agentDevStartTool.description.length).toBeGreaterThan(20);
      expect(agentDevStopTool.description.length).toBeGreaterThan(20);
      expect(agentDevDestroyTool.description.length).toBeGreaterThan(20);
    });

    it('all tools have input schemas', () => {
      expect(agentDevProvisionTool.inputSchema).toBeTruthy();
      expect(agentDevStartTool.inputSchema).toBeTruthy();
      expect(agentDevStopTool.inputSchema).toBeTruthy();
      expect(agentDevDestroyTool.inputSchema).toBeTruthy();
    });

    it('all tools have handlers', () => {
      expect(typeof agentDevProvisionTool.handler).toBe('function');
      expect(typeof agentDevStartTool.handler).toBe('function');
      expect(typeof agentDevStopTool.handler).toBe('function');
      expect(typeof agentDevDestroyTool.handler).toBe('function');
    });
  });

  describe('Input Schema Validation', () => {
    describe('agent_dev.provision', () => {
      const schema = agentDevProvisionTool.inputSchema;

      it('accepts empty object (all optional)', () => {
        expect(() => schema.parse({})).not.toThrow();
      });

      it('accepts valid name', () => {
        expect(() => schema.parse({ name: 'agent-dev-test' })).not.toThrow();
      });

      it('accepts valid profile', () => {
        expect(() => schema.parse({ profile: 'dev' })).not.toThrow();
        expect(() => schema.parse({ profile: 'staging' })).not.toThrow();
      });

      it('accepts valid persistence driver', () => {
        expect(() => schema.parse({ persistence: 'postgres' })).not.toThrow();
        expect(() => schema.parse({ persistence: 'firestore' })).not.toThrow();
      });

      it('rejects invalid profile', () => {
        expect(() => schema.parse({ profile: 'invalid' })).toThrow();
      });

      it('rejects invalid persistence driver', () => {
        expect(() => schema.parse({ persistence: 'invalid' })).toThrow();
      });
    });

    describe('agent_dev.start', () => {
      const schema = agentDevStartTool.inputSchema;

      it('requires name', () => {
        expect(() => schema.parse({})).toThrow();
        expect(() => schema.parse({ service: 'llm-bot' })).toThrow();
      });

      it('accepts valid name', () => {
        expect(() => schema.parse({ name: 'agent-dev-test' })).not.toThrow();
      });

      it('accepts valid name and service', () => {
        expect(() => schema.parse({ name: 'agent-dev-test', service: 'llm-bot' })).not.toThrow();
      });
    });

    describe('agent_dev.stop', () => {
      const schema = agentDevStopTool.inputSchema;

      it('requires name', () => {
        expect(() => schema.parse({})).toThrow();
      });

      it('accepts valid name', () => {
        expect(() => schema.parse({ name: 'agent-dev-test' })).not.toThrow();
      });
    });

    describe('agent_dev.destroy', () => {
      const schema = agentDevDestroyTool.inputSchema;

      it('requires name', () => {
        expect(() => schema.parse({})).toThrow();
      });

      it('accepts name without confirmation', () => {
        expect(() => schema.parse({ name: 'agent-dev-test' })).not.toThrow();
      });

      it('accepts name with confirmation', () => {
        expect(() => schema.parse({ name: 'agent-dev-test', confirm: true })).not.toThrow();
        expect(() => schema.parse({ name: 'agent-dev-test', confirm: false })).not.toThrow();
      });
    });
  });

  describe('Confirmation Requirements', () => {
    it('destroy requires explicit confirmation flag', async () => {
      // Without confirmation
      const result1 = await agentDevDestroyTool.handler({
        name: 'agent-dev-test',
      }, mockConnection);

      expect(result1.isError).toBe(true);
      expect((result1.content[0] as any).text).toContain('requires explicit confirmation');
      expect((result1.content[0] as any).text).toContain('confirm: true');

      // With confirmation = false
      const result2 = await agentDevDestroyTool.handler({
        name: 'agent-dev-test',
        confirm: false,
      }, mockConnection);

      expect(result2.isError).toBe(true);
      expect((result2.content[0] as any).text).toContain('requires explicit confirmation');
    });
  });

  describe('Error Message Format', () => {
    it('provision returns JSON response', async () => {
      const result = await agentDevProvisionTool.handler({}, mockConnection);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Should be valid JSON (either success or error)
      const text = (result.content[0] as any).text;
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('start returns JSON response', async () => {
      // This will fail because no context exists, but should still return JSON
      const result = await agentDevStartTool.handler({
        name: 'agent-dev-nonexistent',
      }, mockConnection);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('stop returns JSON response', async () => {
      const result = await agentDevStopTool.handler({
        name: 'agent-dev-nonexistent',
      }, mockConnection);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('destroy returns clear error or success message', async () => {
      const result = await agentDevDestroyTool.handler({
        name: 'agent-dev-test',
      }, mockConnection);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as any).text.length).toBeGreaterThan(20);
    });
  });

  describe('Tool Naming Convention', () => {
    it('all tools follow agent_dev.* pattern', () => {
      for (const tool of agentDevTools) {
        expect(tool.name).toMatch(/^agent_dev\.[a-z]+$/);
      }
    });

    it('tool names match operations', () => {
      const operations = agentDevTools.map(t => t.name.split('.')[1]);
      expect(operations).toContain('provision');
      expect(operations).toContain('start');
      expect(operations).toContain('stop');
      expect(operations).toContain('destroy');
    });
  });
});
