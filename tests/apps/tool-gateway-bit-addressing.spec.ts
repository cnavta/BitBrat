import request from 'supertest';
import { Express } from 'express';
import { McpBridge } from '../../src/common/mcp/bridge';
import { ToolRegistry } from '../../src/services/llm-bot/tools/registry';
import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { BitBratTool } from '../../src/types/tools';
import { z } from 'zod';

/**
 * BL2-100 / BL2-101 — Bit-qualified addressing for platform (bit.*) tools (TA §4.2, Option A).
 *
 * The fabric used to flatten every tool id to `mcp:<toolName>`, so each Bit's identical `bit.*`
 * tools collided (last-writer-wins). These tests assert the additive, read-path qualification:
 *   - platform (`bit.*`) ids become `mcp:<bit>/<tool>` (displayName unchanged),
 *   - domain ids are untouched,
 *   - two Bits' `bit.info` no longer collide and each is individually invocable through the gateway.
 */
describe('Tool Gateway — Bit-qualified addressing (bit.*)', () => {
  describe('McpBridge.translateTool id qualification', () => {
    it('qualifies platform (bit.*) tool ids with the origin Bit name; leaves displayName unchanged', () => {
      const bridge = new McpBridge({} as any, 'auth');
      const tool = bridge.translateTool({ name: 'bit.health', description: 'health', inputSchema: { type: 'object' } });
      expect(tool.id).toBe('mcp:auth/bit.health');
      expect(tool.displayName).toBe('bit.health');
      expect(tool.originServer).toBe('auth');
    });

    it('does NOT qualify domain tool ids (no behavior change)', () => {
      const bridge = new McpBridge({} as any, 'story-engine');
      const tool = bridge.translateTool({ name: 'story.generate', description: 'gen', inputSchema: { type: 'object' } });
      expect(tool.id).toBe('mcp:story.generate');
    });

    it('produces distinct ids for the same bit.* tool on different Bits (no collision)', () => {
      const authBridge = new McpBridge({} as any, 'auth');
      const persistenceBridge = new McpBridge({} as any, 'persistence');
      const a = authBridge.translateTool({ name: 'bit.info', inputSchema: { type: 'object' } });
      const p = persistenceBridge.translateTool({ name: 'bit.info', inputSchema: { type: 'object' } });
      expect(a.id).toBe('mcp:auth/bit.info');
      expect(p.id).toBe('mcp:persistence/bit.info');
      expect(a.id).not.toBe(p.id);
    });
  });

  describe('Gateway enumerates + invokes Bit-qualified ids', () => {
    let app: Express;
    let server: ToolGatewayServer;
    let registry: ToolRegistry;

    beforeEach(() => {
      server = new ToolGatewayServer();
      app = server.getApp() as any;
      registry = (server as any).registry;
    });

    function makeBitInfo(bit: string): BitBratTool {
      return {
        id: `mcp:${bit}/bit.info`,
        source: 'mcp',
        displayName: 'bit.info',
        description: `info for ${bit}`,
        originServer: bit,
        inputSchema: z.object({}),
        execute: async () => ({ name: bit }),
      };
    }

    it('lists which Bit owns which bit.info without last-writer-wins collision', async () => {
      registry.registerTool(makeBitInfo('auth'));
      registry.registerTool(makeBitInfo('persistence'));

      const res = await request(app).get('/v1/tools');
      expect(res.status).toBe(200);
      const ids = res.body.tools.map((t: any) => t.id);
      expect(ids).toContain('mcp:auth/bit.info');
      expect(ids).toContain('mcp:persistence/bit.info');
    });

    it('invokes a specific Bit via its qualified id (URL-encoded for the REST mirror)', async () => {
      registry.registerTool(makeBitInfo('auth'));
      registry.registerTool(makeBitInfo('persistence'));

      const id = encodeURIComponent('mcp:persistence/bit.info');
      const res = await request(app).post(`/v1/tools/${id}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ name: 'persistence' });
    });
  });
});
