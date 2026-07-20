/**
 * Tests for 'brat context list' command
 */

import { executeContextList } from './list';
import { ContextResolver } from '../../context/context-resolver';
import { getCurrentContext, setCurrentContext, initBratrc } from '../../config/bratrc';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock console methods
const mockLog = jest.spyOn(console, 'log').mockImplementation();
const mockError = jest.spyOn(console, 'error').mockImplementation();
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  return undefined as never;
});

describe('brat context list', () => {
  const mockRepoRoot = '/mock/repo';
  const bratrcPath = path.join(os.homedir(), '.bratrc');
  let bratrcBackup: string | null = null;

  beforeEach(() => {
    jest.clearAllMocks();

    // Backup .bratrc if it exists
    if (fs.existsSync(bratrcPath)) {
      bratrcBackup = fs.readFileSync(bratrcPath, 'utf8');
    }

    // Mock ContextResolver
    jest.spyOn(ContextResolver.prototype, 'listContexts').mockResolvedValue(['local', 'staging', 'prod']);
    jest.spyOn(ContextResolver.prototype, 'getRawContext').mockImplementation((name: string) => {
      const contexts: Record<string, any> = {
        local: {
          description: 'Local Docker development environment',
          deployment: { type: 'docker-compose' },
          tags: ['development', 'local'],
        },
        staging: {
          description: 'Remote staging environment on bitbrat.lan',
          deployment: { type: 'docker-compose' },
          tags: ['staging', 'remote'],
        },
        prod: {
          description: 'Production environment on GCP',
          deployment: { type: 'cloud-run' },
          tags: ['production', 'gcp'],
        },
      };
      return contexts[name];
    });
  });

  afterEach(() => {
    // Restore .bratrc
    if (bratrcBackup !== null) {
      fs.writeFileSync(bratrcPath, bratrcBackup, 'utf8');
    } else if (fs.existsSync(bratrcPath)) {
      fs.unlinkSync(bratrcPath);
    }
  });

  it('lists all contexts in table format', async () => {
    initBratrc();
    setCurrentContext('staging');

    await executeContextList();

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');

    // Should have header
    expect(output).toContain('NAME');
    expect(output).toContain('TYPE');
    expect(output).toContain('DESCRIPTION');
    expect(output).toContain('TAGS');

    // Should list all contexts
    expect(output).toContain('local');
    expect(output).toContain('staging');
    expect(output).toContain('prod');

    // Should highlight current context
    expect(output).toContain('* staging');

    // Should show deployment types
    expect(output).toContain('docker-compose');
    expect(output).toContain('cloud-run');
  });

  it('shows local as current when no .bratrc exists', async () => {
    if (fs.existsSync(bratrcPath)) {
      fs.unlinkSync(bratrcPath);
    }

    await executeContextList();

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('* Current context: local');
  });

  it('outputs JSON format when requested', async () => {
    initBratrc();
    setCurrentContext('prod');

    await executeContextList({ format: 'json' });

    const jsonOutput = mockLog.mock.calls[0][0];
    const parsed = JSON.parse(jsonOutput);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toHaveProperty('name');
    expect(parsed[0]).toHaveProperty('current');
    expect(parsed[0]).toHaveProperty('type');
    expect(parsed[0]).toHaveProperty('description');
    expect(parsed[0]).toHaveProperty('tags');

    // prod should be marked as current
    const prodContext = parsed.find((c: any) => c.name === 'prod');
    expect(prodContext.current).toBe(true);
  });

  it('handles empty context list gracefully', async () => {
    jest.spyOn(ContextResolver.prototype, 'listContexts').mockResolvedValue([]);

    await executeContextList();

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No execution contexts found');
    expect(output).toContain('brat context create');
  });

  it('handles errors gracefully', async () => {
    jest.spyOn(ContextResolver.prototype, 'listContexts').mockRejectedValue(
      new Error('architecture.yaml not found')
    );

    await executeContextList();

    expect(mockError).toHaveBeenCalledWith('Error listing contexts: architecture.yaml not found');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('sorts contexts alphabetically', async () => {
    jest.spyOn(ContextResolver.prototype, 'listContexts').mockResolvedValue(['prod', 'local', 'staging']);

    await executeContextList();

    const output = mockLog.mock.calls.map(c => c[0]).join('\n');
    const localIndex = output.indexOf('local');
    const prodIndex = output.indexOf('prod');
    const stagingIndex = output.indexOf('staging');

    // local should come before prod, which should come before staging (alphabetically)
    expect(localIndex).toBeLessThan(prodIndex);
    expect(prodIndex).toBeLessThan(stagingIndex);
  });
});
