/**
 * Sprint 349: Argument Parser Tests
 */

import { parseArgs } from './index';

describe('parseArgs - Sprint 349', () => {
  const baseArgv = ['node', 'brat'];

  describe('--context flag', () => {
    it('parses --context flag', () => {
      const { flags } = parseArgs([...baseArgv, 'deploy', '--context', 'staging']);

      expect(flags.context).toBe('staging');
      expect((flags as any).contextExplicit).toBe(true);
    });

    it('sets context from flag', () => {
      const { flags } = parseArgs([...baseArgv, '--context', 'prod', 'deploy']);

      expect(flags.context).toBe('prod');
    });
  });

  describe('--env flag (deprecated)', () => {
    it('parses --env flag', () => {
      const { flags } = parseArgs([...baseArgv, 'deploy', '--env', 'staging']);

      expect(flags.env).toBe('staging');
      expect((flags as any).envExplicit).toBe(true);
    });

    it('maps --env to --context for backward compatibility', () => {
      const { flags } = parseArgs([...baseArgv, 'deploy', '--env', 'staging']);

      expect(flags.env).toBe('staging');
      expect(flags.context).toBe('staging');
    });

    it('--context takes priority over --env', () => {
      const { flags } = parseArgs([...baseArgv, '--context', 'prod', '--env', 'staging']);

      expect(flags.context).toBe('prod'); // context wins
      expect(flags.env).toBe('staging'); // env is still set
    });
  });

  describe('--target flag (deprecated)', () => {
    it('parses --target flag', () => {
      const { flags } = parseArgs([...baseArgv, 'docker', 'up', '--target', 'local']);

      expect((flags as any).target).toBe('local');
      expect((flags as any).targetExplicit).toBe(true);
    });

    it('maps --target to --context for backward compatibility', () => {
      const { flags } = parseArgs([...baseArgv, 'docker', 'up', '--target', 'local']);

      expect((flags as any).target).toBe('local');
      expect(flags.context).toBe('local');
    });

    it('--context takes priority over --target', () => {
      const { flags } = parseArgs([...baseArgv, '--context', 'staging', '--target', 'local']);

      expect(flags.context).toBe('staging'); // context wins
      expect((flags as any).target).toBe('local'); // target is still set
    });
  });

  describe('flag priority', () => {
    it('--context takes priority over --env and --target', () => {
      const { flags } = parseArgs([
        ...baseArgv,
        '--context', 'prod',
        '--env', 'staging',
        '--target', 'local'
      ]);

      expect(flags.context).toBe('prod');
      expect(flags.env).toBe('staging');
      expect((flags as any).target).toBe('local');
    });

    it('--env sets context when no --context', () => {
      const { flags } = parseArgs([...baseArgv, '--env', 'staging']);

      expect(flags.context).toBe('staging');
    });

    it('--target sets context when no --context or --env', () => {
      const { flags } = parseArgs([...baseArgv, '--target', 'local']);

      expect(flags.context).toBe('local');
    });
  });

  describe('existing flags still work', () => {
    it('parses --project-id', () => {
      const { flags } = parseArgs([...baseArgv, '--project-id', 'my-project']);

      expect(flags.projectId).toBe('my-project');
    });

    it('parses --region', () => {
      const { flags } = parseArgs([...baseArgv, '--region', 'us-west1']);

      expect(flags.region).toBe('us-west1');
    });

    it('parses --dry-run', () => {
      const { flags } = parseArgs([...baseArgv, '--dry-run']);

      expect(flags.dryRun).toBe(true);
    });

    it('parses --json', () => {
      const { flags } = parseArgs([...baseArgv, '--json']);

      expect(flags.json).toBe(true);
    });

    it('parses multiple flags together', () => {
      const { flags } = parseArgs([
        ...baseArgv,
        '--context', 'staging',
        '--project-id', 'my-project',
        '--region', 'us-central1',
        '--dry-run',
        '--json'
      ]);

      expect(flags.context).toBe('staging');
      expect(flags.projectId).toBe('my-project');
      expect(flags.region).toBe('us-central1');
      expect(flags.dryRun).toBe(true);
      expect(flags.json).toBe(true);
    });
  });

  describe('command parsing', () => {
    it('parses simple commands', () => {
      const { cmd } = parseArgs([...baseArgv, 'deploy', 'services']);

      expect(cmd).toEqual(['deploy', 'services']);
    });

    it('parses commands with flags', () => {
      const { cmd, flags } = parseArgs([
        ...baseArgv,
        'deploy',
        '--context', 'staging',
        'service',
        'llm-bot'
      ]);

      expect(cmd).toEqual(['deploy', 'service', 'llm-bot']);
      expect(flags.context).toBe('staging');
    });

    it('parses flags before and after commands', () => {
      const { cmd, flags } = parseArgs([
        ...baseArgv,
        '--context', 'staging',
        'deploy',
        '--dry-run',
        'service',
        'llm-bot'
      ]);

      expect(cmd).toEqual(['deploy', 'service', 'llm-bot']);
      expect(flags.context).toBe('staging');
      expect(flags.dryRun).toBe(true);
    });
  });

  describe('rest arguments', () => {
    it('captures unknown flags in rest', () => {
      const { rest } = parseArgs([...baseArgv, 'deploy', '--unknown-flag', 'value']);

      expect(rest).toContain('--unknown-flag=value');
    });

    it('captures boolean flags in rest', () => {
      const { rest } = parseArgs([...baseArgv, 'deploy', '--verbose']);

      expect(rest).toContain('--verbose');
    });
  });

  describe('environment variables', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('reads BITBRAT_ENV from environment', () => {
      process.env = { ...originalEnv, BITBRAT_ENV: 'staging' };

      const { flags } = parseArgs([...baseArgv, 'deploy']);

      expect(flags.env).toBe('staging');
    });

    it('reads PROJECT_ID from environment', () => {
      process.env = { ...originalEnv, PROJECT_ID: 'my-gcp-project' };

      const { flags } = parseArgs([...baseArgv, 'deploy']);

      expect(flags.projectId).toBe('my-gcp-project');
    });

    it('CLI flags override environment variables', () => {
      process.env = { ...originalEnv, BITBRAT_ENV: 'staging', PROJECT_ID: 'env-project' };

      const { flags } = parseArgs([
        ...baseArgv,
        '--env', 'prod',
        '--project-id', 'cli-project'
      ]);

      expect(flags.env).toBe('prod');
      expect(flags.projectId).toBe('cli-project');
    });
  });
});
