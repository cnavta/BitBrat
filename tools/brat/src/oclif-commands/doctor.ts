/**
 * Doctor Command
 *
 * Runs system diagnostics to check prerequis

ites for running brat commands.
 * Verifies Node.js, Docker, gcloud, and terraform availability.
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { execCmd } from '../orchestration/exec';

interface CheckResult {
  ok: boolean;
  version: string;
}

interface DoctorResults {
  ok: boolean;
  checks: Record<string, CheckResult>;
}

export default class Doctor extends BratCommand {
  static description = 'Run system diagnostics and verify prerequisites';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --ci',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output results as JSON',
      default: false,
    }),
    ci: Flags.boolean({
      description: 'CI mode - skip tool probes and mark them as OK',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);

    this.logger.debug('Running system diagnostics');

    const checks: Record<string, CheckResult> = {};

    // Node.js version (always OK - we're running it)
    const nodeVersion = process.version;
    checks.node = { ok: true, version: nodeVersion };
    this.logger.debug({ version: nodeVersion }, 'Node.js check');

    // Helper function to probe for a tool
    const probe = async (name: string, cmd: string, args: string[]): Promise<void> => {
      try {
        const res = await execCmd(cmd, args);
        const ok = res.code === 0;
        let version = '';
        if (ok) {
          const out = (res.stdout || res.stderr || '').trim();
          version = out.split('\n')[0];
        }
        checks[name] = { ok, version };
        this.logger.debug({ name, ok, version }, 'Tool check');
      } catch (error) {
        checks[name] = { ok: false, version: '' };
        this.logger.debug({ name, error }, 'Tool check failed');
      }
    };

    // In CI mode, skip tool probes
    if (flags.ci) {
      this.logger.info('CI mode - skipping tool probes');
      checks.gcloud = { ok: true, version: 'ci-skip' };
      checks.terraform = { ok: true, version: 'ci-skip' };
      checks.docker = { ok: true, version: 'ci-skip' };
    } else {
      // Probe for required tools in parallel
      await Promise.all([
        probe('gcloud', 'gcloud', ['version']),
        probe('terraform', 'terraform', ['version']),
        probe('docker', 'docker', ['--version']),
      ]);
    }

    // Determine overall status
    const ok = Object.values(checks).every((c) => c && c.ok);
    const result: DoctorResults = { ok, checks };

    // Output results
    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
    } else {
      this.log('Doctor results:');
      for (const [name, check] of Object.entries(checks)) {
        const status = check.ok ? 'OK' : 'MISSING';
        const version = check.version ? ` (${check.version})` : '';
        this.log(`- ${name}: ${status}${version}`);
      }

      if (!ok) {
        this.log('');
        this.error('Some prerequisites are missing. Install missing tools and try again.', {
          exit: 3,
        });
      }
    }

    // Exit with code 3 if checks failed (unless --json, let oclif handle it)
    if (!ok && !flags.json) {
      this.exit(3);
    }
  }
}
