/**
 * oclif Command: config migrate
 * Sprint 6: S6-M2.1
 *
 * Detects architecture.yaml schema version and generates migration guidance
 * for upgrading from v1 to v2 infrastructure model.
 *
 * Features:
 * - Automatic v1/v2 detection
 * - Breaking change analysis
 * - Migration path recommendations
 * - Dry-run mode (preview only)
 * - JSON/YAML output formats
 *
 * Examples:
 *   brat config migrate
 *   brat config migrate --dry-run
 *   brat config migrate --format json
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { MigrationDetector } from '../../validation/migration-detector';
import type { MigrationReport } from '../../validation/migration-detector';
import * as yaml from 'yaml';

export default class ConfigMigrate extends BratCommand {
  static description = 'Detect schema version and generate v1 → v2 migration guidance';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --format yaml',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    'dry-run': Flags.boolean({
      description: 'Preview migration report without making changes',
      default: true,
    }),
    format: Flags.string({
      description: 'Output format',
      options: ['text', 'json', 'yaml'],
      default: 'text',
    }),
  };

  async run(): Promise<MigrationReport> {
    const { flags } = await this.parse(ConfigMigrate);

    this.logger.info('Detecting architecture.yaml schema version...');

    // Generate migration report
    const detector = new MigrationDetector(this.repoRoot);
    const report = detector.generateMigrationReport();

    // Log detection results
    this.logger.info(`Detected version: ${report.detectedVersion}`);
    if (report.breaking.length > 0) {
      this.logger.warn(`Found ${report.breaking.length} breaking change(s)`);
    }

    // Output report
    if (flags.format === 'json') {
      this.log(JSON.stringify(report, null, 2));
    } else if (flags.format === 'yaml') {
      this.log(yaml.stringify(report));
    } else {
      this.log(MigrationDetector.formatMigrationReport(report));
    }

    // Show dry-run notice
    if (flags['dry-run'] && report.detectedVersion === 'v1') {
      this.log('');
      this.log('ℹ️  DRY-RUN MODE: No changes made to architecture.yaml');
      this.log('   Remove --dry-run flag to apply automatic migrations (future feature)');
      this.log('');
    }

    // Exit with warning code if migration needed
    if (report.breaking.length > 0) {
      this.warn(
        `Migration required: ${report.breaking.length} breaking change(s) detected`
      );
    }

    return report;
  }
}
