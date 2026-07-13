import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  getPreferencePath,
  loadPreference,
  savePreference,
  clearPreference,
  getPreferredAgentId,
  setPreferredAgentId,
  type CodingAgentPreference,
} from '../discovery/preference';

describe('Preference persistence', () => {
  const realPrefPath = getPreferencePath();
  let backupContent: string | null = null;

  beforeAll(async () => {
    // Backup existing .bratrc if it exists
    try {
      backupContent = await fs.readFile(realPrefPath, 'utf-8');
    } catch (err) {
      // No existing file to backup
      backupContent = null;
    }
  });

  afterAll(async () => {
    // Restore backup if it existed
    if (backupContent !== null) {
      await fs.writeFile(realPrefPath, backupContent, 'utf-8');
    } else {
      // Clean up test file
      try {
        await fs.unlink(realPrefPath);
      } catch (err) {
        // Ignore if file doesn't exist
      }
    }
  });

  afterEach(async () => {
    // Clean up .bratrc after each test
    try {
      await fs.unlink(realPrefPath);
    } catch (err) {
      // Ignore if file doesn't exist
    }
  });

  describe('getPreferencePath()', () => {
    it('should return path to .bratrc in home directory', () => {
      const prefPath = getPreferencePath();
      expect(prefPath).toBe(realPrefPath);
      expect(prefPath).toContain('.bratrc');
    });
  });

  describe('loadPreference()', () => {
    it('should return null when file does not exist', async () => {
      const pref = await loadPreference();
      expect(pref).toBeNull();
    });

    it('should load coding agent preference from file', async () => {
      const testPref: CodingAgentPreference = {
        preferred: 'claude-code',
        plugins: {
          'claude-code': { someOption: 'value' },
        },
      };

      await fs.writeFile(
        realPrefPath,
        `codingAgent:\n  preferred: claude-code\n  plugins:\n    claude-code:\n      someOption: value`,
        'utf-8'
      );

      const pref = await loadPreference();
      expect(pref).toEqual(testPref);
    });

    it('should return null when codingAgent section is missing', async () => {
      await fs.writeFile(realPrefPath, 'otherSection:\n  key: value', 'utf-8');

      const pref = await loadPreference();
      expect(pref).toBeNull();
    });

    it('should return null and log warning on invalid YAML', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await fs.writeFile(realPrefPath, 'invalid: yaml: content:', 'utf-8');

      const pref = await loadPreference();
      expect(pref).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('savePreference()', () => {
    it('should create new file with preference', async () => {
      const testPref: CodingAgentPreference = {
        preferred: 'aider',
      };

      await savePreference(testPref);

      const content = await fs.readFile(realPrefPath, 'utf-8');
      expect(content).toContain('codingAgent:');
      expect(content).toContain('preferred: aider');
    });

    it('should merge with existing preferences', async () => {
      // Create initial file with other sections
      await fs.writeFile(realPrefPath, 'otherSection:\n  key: value', 'utf-8');

      const testPref: CodingAgentPreference = {
        preferred: 'claude-code',
      };

      await savePreference(testPref);

      const content = await fs.readFile(realPrefPath, 'utf-8');
      expect(content).toContain('otherSection:');
      expect(content).toContain('codingAgent:');
      expect(content).toContain('preferred: claude-code');
    });

    it('should overwrite existing codingAgent section', async () => {
      await fs.writeFile(realPrefPath, 'codingAgent:\n  preferred: old-agent', 'utf-8');

      const testPref: CodingAgentPreference = {
        preferred: 'new-agent',
      };

      await savePreference(testPref);

      const content = await fs.readFile(realPrefPath, 'utf-8');
      expect(content).toContain('preferred: new-agent');
      expect(content).not.toContain('old-agent');
    });

    it('should set file permissions to 600', async () => {
      const testPref: CodingAgentPreference = {
        preferred: 'claude-code',
      };

      await savePreference(testPref);

      const stats = await fs.stat(realPrefPath);
      // On Unix systems, check permissions (won't work on Windows)
      if (process.platform !== 'win32') {
        const mode = stats.mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });
  });

  describe('clearPreference()', () => {
    it('should return false when file does not exist', async () => {
      const cleared = await clearPreference();
      expect(cleared).toBe(false);
    });

    it('should remove codingAgent section and keep other sections', async () => {
      await fs.writeFile(
        realPrefPath,
        'codingAgent:\n  preferred: claude-code\notherSection:\n  key: value',
        'utf-8'
      );

      const cleared = await clearPreference();
      expect(cleared).toBe(true);

      const content = await fs.readFile(realPrefPath, 'utf-8');
      expect(content).toContain('otherSection:');
      expect(content).not.toContain('codingAgent:');
    });

    it('should delete file when it becomes empty', async () => {
      await fs.writeFile(realPrefPath, 'codingAgent:\n  preferred: claude-code', 'utf-8');

      const cleared = await clearPreference();
      expect(cleared).toBe(true);

      // File should not exist
      await expect(fs.access(realPrefPath)).rejects.toThrow();
    });

    it('should return false when codingAgent section does not exist', async () => {
      await fs.writeFile(realPrefPath, 'otherSection:\n  key: value', 'utf-8');

      const cleared = await clearPreference();
      expect(cleared).toBe(false);
    });
  });

  describe('getPreferredAgentId()', () => {
    it('should return null when no preference exists', async () => {
      const agentId = await getPreferredAgentId();
      expect(agentId).toBeNull();
    });

    it('should return preferred agent ID', async () => {
      await fs.writeFile(realPrefPath, 'codingAgent:\n  preferred: aider', 'utf-8');

      const agentId = await getPreferredAgentId();
      expect(agentId).toBe('aider');
    });

    it('should return null when preferred is not set', async () => {
      await fs.writeFile(realPrefPath, 'codingAgent:\n  plugins: {}', 'utf-8');

      const agentId = await getPreferredAgentId();
      expect(agentId).toBeNull();
    });
  });

  describe('setPreferredAgentId()', () => {
    it('should save preferred agent ID', async () => {
      await setPreferredAgentId('continue');

      const content = await fs.readFile(realPrefPath, 'utf-8');
      expect(content).toContain('preferred: continue');
    });

    it('should preserve existing plugins configuration', async () => {
      const initialPref: CodingAgentPreference = {
        preferred: 'old',
        plugins: {
          'old-agent': { option: 'value' },
        },
      };
      await savePreference(initialPref);

      await setPreferredAgentId('new-agent');

      const pref = await loadPreference();
      expect(pref?.preferred).toBe('new-agent');
      expect(pref?.plugins?.['old-agent']).toEqual({ option: 'value' });
    });
  });
});
