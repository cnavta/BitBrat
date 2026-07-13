import { AgentRegistry } from '../agent-registry';
import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from '../plugins/base-plugin';
import type { ChildProcess } from 'child_process';

// Mock plugin for testing
class MockPlugin extends BasePlugin {
  readonly id = 'mock-agent';
  readonly name = 'Mock Agent';
  readonly minVersion = '1.0.0';

  async detect(): Promise<AgentDetectionResult> {
    return { installed: true, version: '1.0.0', path: '/usr/local/bin/mock' };
  }

  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    return {
      command: 'mock',
      args: [],
      env: {},
      cwd: projectContext.root,
      configFiles: [],
    };
  }

  async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
    throw new Error('Not implemented in mock');
  }
}

describe('AgentRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    AgentRegistry.clear();
  });

  afterEach(() => {
    // Clean up after each test
    AgentRegistry.clear();
  });

  describe('register()', () => {
    it('should register a valid plugin', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      expect(AgentRegistry.hasPlugin('mock-agent')).toBe(true);
      expect(AgentRegistry.count()).toBe(1);
    });

    it('should throw if plugin has no id', () => {
      const invalidPlugin = {
        name: 'Test',
        minVersion: '1.0.0',
        detect: async () => ({ installed: false }),
        prepareConfig: async () => ({ command: 'test', args: [], configFiles: [] }),
        launch: async () => ({} as ChildProcess),
      } as any;

      expect(() => AgentRegistry.register(invalidPlugin)).toThrow('must have an id property');
    });

    it('should throw if plugin has no name', () => {
      const invalidPlugin = {
        id: 'test',
        minVersion: '1.0.0',
        detect: async () => ({ installed: false }),
        prepareConfig: async () => ({ command: 'test', args: [], configFiles: [] }),
        launch: async () => ({} as ChildProcess),
      } as any;

      expect(() => AgentRegistry.register(invalidPlugin)).toThrow('must have a name property');
    });

    it('should throw if plugin has no minVersion', () => {
      const invalidPlugin = {
        id: 'test',
        name: 'Test',
        detect: async () => ({ installed: false }),
        prepareConfig: async () => ({ command: 'test', args: [], configFiles: [] }),
        launch: async () => ({} as ChildProcess),
      } as any;

      expect(() => AgentRegistry.register(invalidPlugin)).toThrow('must have a minVersion property');
    });

    it('should throw if plugin has no detect method', () => {
      const invalidPlugin = {
        id: 'test',
        name: 'Test',
        minVersion: '1.0.0',
        prepareConfig: async () => ({ command: 'test', args: [], configFiles: [] }),
        launch: async () => ({} as ChildProcess),
      } as any;

      expect(() => AgentRegistry.register(invalidPlugin)).toThrow('must implement detect() method');
    });

    it('should replace existing plugin with same id', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();

      AgentRegistry.register(plugin1);
      AgentRegistry.register(plugin2);

      expect(AgentRegistry.count()).toBe(1);
    });
  });

  describe('getPlugin()', () => {
    it('should return registered plugin by id', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      const retrieved = AgentRegistry.getPlugin('mock-agent');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('mock-agent');
    });

    it('should return undefined for non-existent plugin', () => {
      const retrieved = AgentRegistry.getPlugin('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getByName()', () => {
    it('should return plugin by name (case-insensitive)', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      const retrieved = AgentRegistry.getByName('Mock Agent');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Mock Agent');
    });

    it('should be case-insensitive', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      const retrieved = AgentRegistry.getByName('MOCK AGENT');
      expect(retrieved).toBeDefined();
    });

    it('should return undefined for non-existent name', () => {
      const retrieved = AgentRegistry.getByName('Non Existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllPlugins()', () => {
    it('should return empty array when no plugins registered', () => {
      const plugins = AgentRegistry.getAllPlugins();
      expect(plugins).toEqual([]);
    });

    it('should return all registered plugins', () => {
      const plugin1 = new MockPlugin();

      class SecondPlugin extends BasePlugin {
        readonly id = 'second';
        readonly name = 'Second';
        readonly minVersion = '1.0.0';
        async detect() { return { installed: false }; }
        async prepareConfig() { return { command: 'second', args: [], configFiles: [] }; }
        async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
          throw new Error('Not implemented');
        }
      }
      const plugin2 = new SecondPlugin();

      AgentRegistry.register(plugin1);
      AgentRegistry.register(plugin2);

      const plugins = AgentRegistry.getAllPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins.map(p => p.id)).toContain('mock-agent');
      expect(plugins.map(p => p.id)).toContain('second');
    });
  });

  describe('getAllPluginIds()', () => {
    it('should return empty array when no plugins registered', () => {
      const ids = AgentRegistry.getAllPluginIds();
      expect(ids).toEqual([]);
    });

    it('should return all plugin IDs', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      const ids = AgentRegistry.getAllPluginIds();
      expect(ids).toEqual(['mock-agent']);
    });
  });

  describe('hasPlugin()', () => {
    it('should return true for registered plugin', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      expect(AgentRegistry.hasPlugin('mock-agent')).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      expect(AgentRegistry.hasPlugin('non-existent')).toBe(false);
    });
  });

  describe('unregister()', () => {
    it('should remove registered plugin', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      expect(AgentRegistry.hasPlugin('mock-agent')).toBe(true);

      const removed = AgentRegistry.unregister('mock-agent');
      expect(removed).toBe(true);
      expect(AgentRegistry.hasPlugin('mock-agent')).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      const removed = AgentRegistry.unregister('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should remove all plugins', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      expect(AgentRegistry.count()).toBe(1);

      AgentRegistry.clear();
      expect(AgentRegistry.count()).toBe(0);
    });
  });

  describe('count()', () => {
    it('should return 0 when no plugins registered', () => {
      expect(AgentRegistry.count()).toBe(0);
    });

    it('should return correct count', () => {
      const plugin = new MockPlugin();
      AgentRegistry.register(plugin);

      expect(AgentRegistry.count()).toBe(1);
    });
  });
});
