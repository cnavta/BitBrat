import fs from 'fs';
import path from 'path';
import { updateYaml, updateEnv, replacePlaceholders, isAlreadyInitialized } from './setup';

jest.mock('fs');

describe('Setup Utilities', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  describe('isAlreadyInitialized', () => {
    const root = '/mock/root';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return empty array if no markers exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = isAlreadyInitialized(root);
      expect(result).toEqual([]);
    });

    it('should return detected markers', () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.endsWith('.bitbrat.json')) return true;
        if (typeof p === 'string' && p.endsWith('.secure.local')) return true;
        return false;
      });
      const result = isAlreadyInitialized(root);
      expect(result).toContain('.bitbrat.json');
      expect(result).toContain('.secure.local');
      expect(result).not.toContain('env/local/global.yaml');
    });
  });

  describe('updateYaml', () => {
    it('should add a new key to empty content', () => {
      const result = updateYaml('', 'KEY', 'VALUE');
      expect(result).toBe('KEY: "VALUE"\n');
    });

    it('should update an existing key', () => {
      const content = 'PROJECT_ID: "old-id"\nBOT_NAME: "old-bot"\n';
      const result = updateYaml(content, 'PROJECT_ID', 'new-id');
      expect(result).toBe('PROJECT_ID: "new-id"\nBOT_NAME: "old-bot"\n');
    });

    it('should add a key to existing content', () => {
      const content = 'PROJECT_ID: "my-id"\n';
      const result = updateYaml(content, 'BOT_NAME', 'my-bot');
      expect(result).toBe('PROJECT_ID: "my-id"\nBOT_NAME: "my-bot"\n');
    });
  });

  describe('updateEnv', () => {
    it('should add a new key to empty content', () => {
      const result = updateEnv('', 'KEY', 'VALUE');
      expect(result).toBe('KEY=VALUE\n');
    });

    it('should update an existing key', () => {
      const content = 'API_KEY=old-key\nOTHER=val\n';
      const result = updateEnv(content, 'API_KEY', 'new-key');
      expect(result).toBe('API_KEY=new-key\nOTHER=val\n');
    });
  });

  describe('replacePlaceholders', () => {
    it('should replace %PROJECT_ID% and %BOT_NAME%', () => {
      const content = 'Project is %PROJECT_ID% and bot is %BOT_NAME%.';
      const vars = {
        PROJECT_ID: 'pid-123',
        BOT_NAME: 'Bratty'
      };
      const result = replacePlaceholders(content, vars);
      expect(result).toBe('Project is pid-123 and bot is Bratty.');
    });

    it('should handle multiple occurrences', () => {
      const content = '%BOT_NAME% says hello to %BOT_NAME%.';
      const vars = { BOT_NAME: 'Alice' };
      const result = replacePlaceholders(content, vars);
      expect(result).toBe('Alice says hello to Alice.');
    });

    it('should ignore missing placeholders', () => {
      const content = 'Hello %UNKNOWN%.';
      const result = replacePlaceholders(content, { OTHER: 'val' });
      expect(result).toBe('Hello %UNKNOWN%.');
    });
  });
});
