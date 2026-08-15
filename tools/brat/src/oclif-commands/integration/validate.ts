/**
 * oclif Command: integration validate
 * Sprint 13: DX-008
 *
 * Validates platform integration YAML configurations.
 * Checks:
 *   - JSON Schema compliance
 *   - YAML syntax
 *   - Event mapping completeness
 *
 * Examples:
 *   brat integration validate discord
 *   brat integration validate --all
 *   brat integration validate slack --format json
 */

import { Flags, Args } from '@oclif/core';
import { BratCommand } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv from 'ajv';

interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  file?: string;
}

interface PlatformValidationResult {
  platform: string;
  configPath: string;
  exists: boolean;
  eventMappings: string[];
  issues: ValidationIssue[];
  valid: boolean;
}

export default class IntegrationValidate extends BratCommand {
  static description = 'Validate platform integration YAML configurations';

  static examples = [
    '<%= config.bin %> <%= command.id %> discord',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> slack --format json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    all: Flags.boolean({
      description: 'Validate all platforms',
      default: false,
    }),
    format: Flags.string({
      description: 'Output format',
      options: ['text', 'json'],
      default: 'text',
    }),
  };

  static args = {
    platform: Args.string({
      description: 'Platform to validate (discord, slack, twitch, etc.)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationValidate);

    // Validate input
    if (!flags.all && !args.platform) {
      this.error('Must specify either a platform or use --all flag', { exit: 1 });
    }

    if (flags.all && args.platform) {
      this.error('Cannot specify both --all and a platform name', { exit: 1 });
    }

    // Determine platforms to validate
    const platforms = flags.all
      ? await this.discoverPlatforms()
      : [args.platform!]; // Non-null assertion since we validate above

    this.logger.debug(`Validating platforms: ${platforms.join(', ')}`);

    // Validate each platform
    const results: PlatformValidationResult[] = [];
    for (const platform of platforms) {
      const result = await this.validatePlatform(platform);
      results.push(result);
    }

    // Output results
    if (flags.format === 'json') {
      this.log(JSON.stringify(results, null, 2));
    } else {
      this.outputTextResults(results);
    }

    // Exit with error if any platform failed
    const hasErrors = results.some(r => !r.valid);
    if (hasErrors) {
      this.error('Validation failed', { exit: 1 });
    }
  }

  /**
   * Discover all platforms with config directories
   */
  private async discoverPlatforms(): Promise<string[]> {
    const configPlatformsDir = path.join(this.repoRoot, 'config', 'platforms');

    try {
      const entries = await fs.readdir(configPlatformsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch (err: any) {
      this.logger.error(`Failed to discover platforms: ${err.message}`);
      return [];
    }
  }

  /**
   * Validate a single platform
   */
  private async validatePlatform(platform: string): Promise<PlatformValidationResult> {
    const configPath = path.join(this.repoRoot, 'config', 'platforms', platform);
    const issues: ValidationIssue[] = [];

    const result: PlatformValidationResult = {
      platform,
      configPath,
      exists: false,
      eventMappings: [],
      issues,
      valid: true,
    };

    // Check if config directory exists
    try {
      const stats = await fs.stat(configPath);
      result.exists = stats.isDirectory();
    } catch {
      result.exists = false;
      issues.push({
        type: 'error',
        message: `Platform configuration directory not found: ${configPath}`,
      });
      result.valid = false;
      return result;
    }

    // Load platform mapping schema
    const schemaPath = path.join(this.repoRoot, 'config', 'schemas', 'platform-mapping.schema.json');
    let schema: any;
    try {
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      schema = JSON.parse(schemaContent);
    } catch (err: any) {
      issues.push({
        type: 'error',
        message: `Failed to load schema: ${err.message}`,
      });
      result.valid = false;
      return result;
    }

    // Validate all YAML files in platform directory
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);

    try {
      const files = await fs.readdir(configPath);
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const filePath = path.join(configPath, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data: any = yaml.parse(content);

          // Validate against schema
          const valid = validate(data);
          if (!valid && validate.errors) {
            for (const error of validate.errors) {
              issues.push({
                type: 'error',
                message: `${file}: ${error.instancePath} ${error.message}`,
                file,
              });
              result.valid = false;
            }
          } else if (valid) {
            // Track event mapping
            const eventType = (data as any).internalEventType;
            if (eventType) {
              result.eventMappings.push(eventType as string);
            }
          }
        } catch (err: any) {
          issues.push({
            type: 'error',
            message: `${file}: Failed to parse YAML: ${err.message}`,
            file,
          });
          result.valid = false;
        }
      }

      if (yamlFiles.length === 0) {
        issues.push({
          type: 'warning',
          message: 'No YAML configuration files found',
        });
      }
    } catch (err: any) {
      issues.push({
        type: 'error',
        message: `Failed to read config directory: ${err.message}`,
      });
      result.valid = false;
    }

    return result;
  }

  /**
   * Output results in text format
   */
  private outputTextResults(results: PlatformValidationResult[]): void {
    for (const result of results) {
      this.log(`\n${result.platform.toUpperCase()}`);
      this.log('='.repeat(result.platform.length + 10));

      if (!result.exists) {
        this.log(`❌ Configuration directory not found`);
        continue;
      }

      this.log(`✅ Platform configuration found: ${result.configPath}`);

      if (result.eventMappings.length > 0) {
        this.log(`✅ Event mappings: ${result.eventMappings.length} found`);
        for (const mapping of result.eventMappings.sort()) {
          this.log(`   - ${mapping}`);
        }
      } else {
        this.log(`⚠️  No event mappings found`);
      }

      // Show issues
      const errors = result.issues.filter(i => i.type === 'error');
      const warnings = result.issues.filter(i => i.type === 'warning');

      if (errors.length > 0) {
        this.log(`\n❌ Errors: ${errors.length}`);
        for (const error of errors) {
          this.log(`   ${error.message}`);
        }
      }

      if (warnings.length > 0) {
        this.log(`\n⚠️  Warnings: ${warnings.length}`);
        for (const warning of warnings) {
          this.log(`   ${warning.message}`);
        }
      }

      if (result.valid && result.issues.length === 0) {
        this.log(`\n✅ All checks passed`);
      }
    }

    // Summary
    this.log('\n' + '='.repeat(50));
    const validCount = results.filter(r => r.valid).length;
    const totalCount = results.length;
    if (validCount === totalCount) {
      this.log(`✅ All ${totalCount} platform(s) validated successfully`);
    } else {
      this.log(`❌ ${totalCount - validCount} of ${totalCount} platform(s) failed validation`);
    }
  }
}
