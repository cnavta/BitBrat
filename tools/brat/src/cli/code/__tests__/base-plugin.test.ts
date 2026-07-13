import { BasePlugin, type AgentDetectionResult, type AgentConfig, type ProjectContext } from '../plugins/base-plugin';
import type { ChildProcess } from 'child_process';

// Concrete implementation for testing
class TestPlugin extends BasePlugin {
  readonly id = 'test';
  readonly name = 'Test Plugin';
  readonly minVersion = '1.0.0';

  async detect(): Promise<AgentDetectionResult> {
    return { installed: false };
  }

  async prepareConfig(projectContext: ProjectContext): Promise<AgentConfig> {
    return {
      command: 'test',
      args: [],
      env: {},
      cwd: projectContext.root,
      configFiles: [],
    };
  }

  async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
    throw new Error('Not implemented in test');
  }

  // Expose protected methods for testing
  public testCompareVersions(v1: string, v2: string): boolean {
    return this.compareVersions(v1, v2);
  }

  public testExtractVersion(output: string): string | null {
    return this.extractVersion(output);
  }
}

describe('BasePlugin', () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    plugin = new TestPlugin();
  });

  describe('compareVersions()', () => {
    it('should return true when version equals minVersion', () => {
      expect(plugin.testCompareVersions('1.0.0', '1.0.0')).toBe(true);
    });

    it('should return true when version is greater than minVersion', () => {
      expect(plugin.testCompareVersions('2.0.0', '1.0.0')).toBe(true);
      expect(plugin.testCompareVersions('1.1.0', '1.0.0')).toBe(true);
      expect(plugin.testCompareVersions('1.0.1', '1.0.0')).toBe(true);
    });

    it('should return false when version is less than minVersion', () => {
      expect(plugin.testCompareVersions('0.9.0', '1.0.0')).toBe(false);
      expect(plugin.testCompareVersions('1.0.0', '1.1.0')).toBe(false);
      expect(plugin.testCompareVersions('1.0.0', '1.0.1')).toBe(false);
    });

    it('should handle missing patch version', () => {
      expect(plugin.testCompareVersions('1.0', '1.0.0')).toBe(true);
      expect(plugin.testCompareVersions('1.0.0', '1.0')).toBe(true);
    });

    it('should handle major version differences', () => {
      expect(plugin.testCompareVersions('2.0.0', '1.9.9')).toBe(true);
      expect(plugin.testCompareVersions('1.9.9', '2.0.0')).toBe(false);
    });

    it('should handle minor version differences', () => {
      expect(plugin.testCompareVersions('1.2.0', '1.1.9')).toBe(true);
      expect(plugin.testCompareVersions('1.1.9', '1.2.0')).toBe(false);
    });
  });

  describe('extractVersion()', () => {
    it('should extract version from simple output', () => {
      expect(plugin.testExtractVersion('1.2.3')).toBe('1.2.3');
    });

    it('should extract version with v prefix', () => {
      expect(plugin.testExtractVersion('v1.2.3')).toBe('1.2.3');
    });

    it('should extract version from text output', () => {
      expect(plugin.testExtractVersion('aider version 1.2.3')).toBe('1.2.3');
      expect(plugin.testExtractVersion('Claude Code v0.9.0')).toBe('0.9.0');
    });

    it('should extract version from complex output', () => {
      expect(plugin.testExtractVersion('Tool v2.5.1 (build 12345)')).toBe('2.5.1');
    });

    it('should return null for output without version', () => {
      expect(plugin.testExtractVersion('no version here')).toBeNull();
      expect(plugin.testExtractVersion('')).toBeNull();
    });

    it('should handle multiple lines and extract first version', () => {
      const output = `Claude Code v1.0.0
Build: 12345
Date: 2024-01-01`;
      expect(plugin.testExtractVersion(output)).toBe('1.0.0');
    });
  });
});
