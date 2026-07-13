import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  readBitBratConfig,
  writeBitBratConfig,
  updateBitBratConfig,
  isCodeFirstRun,
  markCodeRunComplete,
  type BitBratConfig,
} from '../utils/bitbrat-config';

describe('bitbrat-config utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitbrat-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('readBitBratConfig()', () => {
    it('should return null when config file does not exist', async () => {
      const config = await readBitBratConfig(tempDir);
      expect(config).toBeNull();
    });

    it('should read existing config file', async () => {
      const expected: BitBratConfig = {
        apiToken: 'test-token-123',
        codeFirstRun: true,
      };

      await fs.writeFile(
        path.join(tempDir, '.bitbrat.json'),
        JSON.stringify(expected),
        'utf-8'
      );

      const config = await readBitBratConfig(tempDir);
      expect(config).toEqual(expected);
    });

    it('should parse config without codeFirstRun field', async () => {
      const expected = {
        apiToken: 'test-token-123',
      };

      await fs.writeFile(
        path.join(tempDir, '.bitbrat.json'),
        JSON.stringify(expected),
        'utf-8'
      );

      const config = await readBitBratConfig(tempDir);
      expect(config).toEqual(expected);
      expect(config?.codeFirstRun).toBeUndefined();
    });
  });

  describe('writeBitBratConfig()', () => {
    it('should write config file with proper formatting', async () => {
      const config: BitBratConfig = {
        apiToken: 'test-token-456',
        codeFirstRun: false,
      };

      await writeBitBratConfig(tempDir, config);

      const content = await fs.readFile(path.join(tempDir, '.bitbrat.json'), 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(config);
      expect(content).toContain('\n'); // Check for pretty-printing
    });
  });

  describe('updateBitBratConfig()', () => {
    it('should create new config if none exists', async () => {
      await updateBitBratConfig(tempDir, {
        apiToken: 'new-token',
        codeFirstRun: true,
      });

      const config = await readBitBratConfig(tempDir);
      expect(config).toEqual({
        apiToken: 'new-token',
        codeFirstRun: true,
      });
    });

    it('should merge updates with existing config', async () => {
      const initial: BitBratConfig = {
        apiToken: 'original-token',
        codeFirstRun: true,
      };

      await writeBitBratConfig(tempDir, initial);
      await updateBitBratConfig(tempDir, { codeFirstRun: false });

      const config = await readBitBratConfig(tempDir);
      expect(config).toEqual({
        apiToken: 'original-token',
        codeFirstRun: false,
      });
    });

    it('should allow updating apiToken', async () => {
      const initial: BitBratConfig = {
        apiToken: 'old-token',
        codeFirstRun: true,
      };

      await writeBitBratConfig(tempDir, initial);
      await updateBitBratConfig(tempDir, { apiToken: 'new-token' });

      const config = await readBitBratConfig(tempDir);
      expect(config?.apiToken).toBe('new-token');
      expect(config?.codeFirstRun).toBe(true);
    });
  });

  describe('isCodeFirstRun()', () => {
    it('should return true when config file does not exist', async () => {
      const result = await isCodeFirstRun(tempDir);
      expect(result).toBe(true);
    });

    it('should return true when codeFirstRun is true', async () => {
      await writeBitBratConfig(tempDir, {
        apiToken: 'test-token',
        codeFirstRun: true,
      });

      const result = await isCodeFirstRun(tempDir);
      expect(result).toBe(true);
    });

    it('should return false when codeFirstRun is false', async () => {
      await writeBitBratConfig(tempDir, {
        apiToken: 'test-token',
        codeFirstRun: false,
      });

      const result = await isCodeFirstRun(tempDir);
      expect(result).toBe(false);
    });

    it('should return true when codeFirstRun is undefined (backwards compatibility)', async () => {
      await writeBitBratConfig(tempDir, {
        apiToken: 'test-token',
      } as BitBratConfig);

      const result = await isCodeFirstRun(tempDir);
      expect(result).toBe(true);
    });
  });

  describe('markCodeRunComplete()', () => {
    it('should set codeFirstRun to false', async () => {
      await writeBitBratConfig(tempDir, {
        apiToken: 'test-token',
        codeFirstRun: true,
      });

      await markCodeRunComplete(tempDir);

      const config = await readBitBratConfig(tempDir);
      expect(config?.codeFirstRun).toBe(false);
    });

    it('should preserve other config fields', async () => {
      await writeBitBratConfig(tempDir, {
        apiToken: 'test-token',
        codeFirstRun: true,
      });

      await markCodeRunComplete(tempDir);

      const config = await readBitBratConfig(tempDir);
      expect(config?.apiToken).toBe('test-token');
    });

    it('should create config if it does not exist', async () => {
      await markCodeRunComplete(tempDir);

      const config = await readBitBratConfig(tempDir);
      expect(config?.codeFirstRun).toBe(false);
    });
  });
});
