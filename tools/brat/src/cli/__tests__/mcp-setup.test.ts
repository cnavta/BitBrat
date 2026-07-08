/**
 * Tests for MCP setup command
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { cmdMcpSetup, McpSetupFlags } from '../mcp-setup';

describe('cmdMcpSetup', () => {
  let tempDir: string;
  let originalHomeDir: string;

  beforeEach(() => {
    // Create temp directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-setup-test-'));

    // Mock os.homedir to return temp dir
    originalHomeDir = os.homedir();
    jest.spyOn(os, 'homedir').mockReturnValue(tempDir);
  });

  afterEach(() => {
    // Restore original homedir
    jest.restoreAllMocks();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create new config file with MCP server', async () => {
    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      target: 'local',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(tempDir, '.claude.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers['test-server']).toBeDefined();
    expect(config.mcpServers['test-server'].type).toBe('stdio');
    expect(config.mcpServers['test-server'].command).toBe('npm');
    expect(config.mcpServers['test-server'].args).toContain('--target');
    expect(config.mcpServers['test-server'].args).toContain('local');
  });

  it('should update existing server config', async () => {
    const configPath = path.join(tempDir, '.claude.json');

    // Create initial config
    const initialConfig = {
      mcpServers: {
        'test-server': {
          type: 'stdio',
          command: 'old-command',
          args: [],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      target: 'staging',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers['test-server'].command).toBe('npm');
    expect(config.mcpServers['test-server'].args).toContain('--target');
    expect(config.mcpServers['test-server'].args).toContain('staging');
  });

  it('should not write config in dry-run mode', async () => {
    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      target: 'local',
      dryRun: true,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(tempDir, '.claude.json');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('should include log level in args when specified', async () => {
    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      target: 'local',
      logLevel: 'debug',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(tempDir, '.claude.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.mcpServers['test-server'].args).toContain('--log-level');
    expect(config.mcpServers['test-server'].args).toContain('debug');
  });

  it('should include audit log path in args when specified', async () => {
    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      target: 'local',
      auditLog: '/custom/audit.log',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(tempDir, '.claude.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.mcpServers['test-server'].args).toContain('--audit-log');
    expect(config.mcpServers['test-server'].args).toContain('/custom/audit.log');
  });

  it('should use default server name when not specified', async () => {
    const flags: McpSetupFlags = {
      scope: 'user',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(tempDir, '.claude.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.mcpServers['bitbrat-dev']).toBeDefined();
  });

  it('should preserve existing mcpServers', async () => {
    const configPath = path.join(tempDir, '.claude.json');

    // Create initial config with existing server
    const initialConfig = {
      mcpServers: {
        'other-server': {
          type: 'http',
          url: 'https://example.com',
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

    const flags: McpSetupFlags = {
      scope: 'user',
      serverName: 'test-server',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Both servers should exist
    expect(config.mcpServers['other-server']).toBeDefined();
    expect(config.mcpServers['test-server']).toBeDefined();
  });

  it('should create project scope config in project root', async () => {
    const projectRoot = process.cwd();
    const flags: McpSetupFlags = {
      scope: 'project',
      serverName: 'test-server',
      dryRun: false,
    };

    await cmdMcpSetup(flags);

    const configPath = path.join(projectRoot, '.mcp.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers['test-server']).toBeDefined();

    // Clean up
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });
});
