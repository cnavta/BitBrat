/**
 * Sprint 349: ~/.bratrc Configuration Tests
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadBratrc,
  saveBratrc,
  getCurrentContext,
  setCurrentContext,
  getContextHistory,
  getPreference,
  setPreference,
  bratrcExists,
  initBratrc,
  getBratrcPath,
  BratrcConfig,
} from './bratrc';

// Mock fs and os modules
jest.mock('fs');
jest.mock('os');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe('bratrc utilities - Sprint 349', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue('/home/testuser');
  });

  describe('getBratrcPath', () => {
    it('returns ~/.bratrc path', () => {
      const result = getBratrcPath();
      expect(result).toBe('/home/testuser/.bratrc');
    });
  });

  describe('loadBratrc', () => {
    it('loads valid ~/.bratrc file', () => {
      const config: BratrcConfig = {
        current_context: 'staging',
        preferences: { auto_confirm_deploys: false },
        history: { last_contexts: ['staging', 'local'] },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
current_context: staging
preferences:
  auto_confirm_deploys: false
history:
  last_contexts:
    - staging
    - local
`);

      const result = loadBratrc();

      expect(result).toEqual(config);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/home/testuser/.bratrc');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/home/testuser/.bratrc', 'utf8');
    });

    it('returns null when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadBratrc();

      expect(result).toBeNull();
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('returns null when file contains invalid YAML', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid: yaml: syntax:');

      const result = loadBratrc();

      expect(result).toBeNull();
    });

    it('returns empty object when file is empty', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('');

      const result = loadBratrc();

      expect(result).toEqual({});
    });
  });

  describe('saveBratrc', () => {
    beforeEach(() => {
      // Reset writeFileSync mock to default implementation
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});
    });

    it('saves config to ~/.bratrc atomically', () => {
      const config: BratrcConfig = {
        current_context: 'staging',
        preferences: { auto_confirm_deploys: false },
      };

      mockFs.existsSync.mockReturnValue(false); // No temp file exists

      saveBratrc(config);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.bratrc.tmp',
        expect.stringContaining('current_context: staging'),
        'utf8'
      );
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        '/home/testuser/.bratrc.tmp',
        '/home/testuser/.bratrc'
      );
    });

    it('cleans up temp file on write error', () => {
      const config: BratrcConfig = { current_context: 'local' };

      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });
      mockFs.existsSync.mockReturnValue(true); // Temp file exists after error

      expect(() => saveBratrc(config)).toThrow('Failed to save ~/.bratrc: Disk full');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/home/testuser/.bratrc.tmp');

      // Reset mock for subsequent tests
      mockFs.writeFileSync.mockImplementation(() => {});
    });

    it('formats YAML with proper indentation', () => {
      const config: BratrcConfig = {
        current_context: 'staging',
        preferences: {
          auto_confirm_deploys: false,
          default_log_level: 'info',
        },
      };

      saveBratrc(config);

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('current_context: staging');
      expect(writtenContent).toContain('preferences:');
      expect(writtenContent).toContain('  auto_confirm_deploys: false');
      expect(writtenContent).toContain('  default_log_level: info');
    });
  });

  describe('getCurrentContext', () => {
    it('returns current_context from ~/.bratrc', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('current_context: staging\n');

      const result = getCurrentContext();

      expect(result).toBe('staging');
    });

    it('returns null when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getCurrentContext();

      expect(result).toBeNull();
    });

    it('returns null when current_context not set', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('preferences:\n  auto_confirm_deploys: false\n');

      const result = getCurrentContext();

      expect(result).toBeNull();
    });
  });

  describe('setCurrentContext', () => {
    it('sets current_context in ~/.bratrc', () => {
      mockFs.existsSync.mockReturnValue(false); // File doesn't exist

      setCurrentContext('staging');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('current_context: staging');
    });

    it('updates existing ~/.bratrc without losing other fields', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
current_context: local
preferences:
  auto_confirm_deploys: false
`);

      setCurrentContext('staging');

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('current_context: staging');
      expect(writtenContent).toContain('auto_confirm_deploys: false');
    });

    it('creates history entry when setting context', () => {
      mockFs.existsSync.mockReturnValue(false);

      setCurrentContext('staging');

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('history:');
      expect(writtenContent).toContain('last_contexts:');
      expect(writtenContent).toContain('- staging');
    });

    it('updates history by moving context to front', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
current_context: local
history:
  last_contexts:
    - local
    - staging
    - prod
`);

      setCurrentContext('staging');

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      const lines = writtenContent.split('\n');
      const historyStartIndex = lines.findIndex((l) => l.includes('last_contexts:'));

      // staging should be first in history
      expect(writtenContent).toMatch(/last_contexts:\s*\n\s*-\s*staging/);
    });

    it('limits history to 10 entries', () => {
      const longHistory = Array.from({ length: 15 }, (_, i) => `ctx${i}`);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
current_context: ctx0
history:
  last_contexts: ${JSON.stringify(longHistory)}
`);

      setCurrentContext('newctx');

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      const historyMatches = writtenContent.match(/- (ctx\d+|newctx)/g);
      expect(historyMatches?.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getContextHistory', () => {
    it('returns context history', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
history:
  last_contexts:
    - staging
    - local
    - prod
`);

      const result = getContextHistory();

      expect(result).toEqual(['staging', 'local', 'prod']);
    });

    it('returns empty array when no history', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getContextHistory();

      expect(result).toEqual([]);
    });

    it('limits returned history', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
history:
  last_contexts:
    - ctx1
    - ctx2
    - ctx3
    - ctx4
    - ctx5
`);

      const result = getContextHistory(3);

      expect(result).toEqual(['ctx1', 'ctx2', 'ctx3']);
    });
  });

  describe('getPreference', () => {
    it('returns preference value', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
preferences:
  auto_confirm_deploys: true
  default_log_level: debug
`);

      expect(getPreference('auto_confirm_deploys')).toBe(true);
      expect(getPreference('default_log_level')).toBe('debug');
    });

    it('returns default value when preference not set', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getPreference('missing_key', 'default_value');

      expect(result).toBe('default_value');
    });

    it('returns undefined when preference not set and no default', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getPreference('missing_key');

      expect(result).toBeUndefined();
    });
  });

  describe('setPreference', () => {
    it('sets preference value', () => {
      mockFs.existsSync.mockReturnValue(false);

      setPreference('auto_confirm_deploys', true);

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('preferences:');
      expect(writtenContent).toContain('auto_confirm_deploys: true');
    });

    it('updates existing preference without losing others', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`
preferences:
  auto_confirm_deploys: false
  default_log_level: info
`);

      setPreference('auto_confirm_deploys', true);

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('auto_confirm_deploys: true');
      expect(writtenContent).toContain('default_log_level: info');
    });
  });

  describe('bratrcExists', () => {
    it('returns true when ~/.bratrc exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = bratrcExists();

      expect(result).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/home/testuser/.bratrc');
    });

    it('returns false when ~/.bratrc does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = bratrcExists();

      expect(result).toBe(false);
    });
  });

  describe('initBratrc', () => {
    it('creates ~/.bratrc with default values', () => {
      mockFs.existsSync.mockReturnValue(false);

      initBratrc('local');

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('current_context: local');
      expect(writtenContent).toContain('auto_confirm_deploys: false');
      expect(writtenContent).toContain('last_contexts:');
    });

    it('does not overwrite existing ~/.bratrc', () => {
      mockFs.existsSync.mockReturnValue(true);

      initBratrc('staging');

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('uses local as default context when not specified', () => {
      mockFs.existsSync.mockReturnValue(false);

      initBratrc();

      const writtenContent = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('current_context: local');
    });
  });
});
