/**
 * oclif Command: integration test
 * Sprint 13: DX-009
 *
 * Tests platform ingress event normalization using fixtures.
 * Loads a fixture file, runs it through the TranslationEngine,
 * and displays detailed field extraction and validation results.
 *
 * Examples:
 *   brat integration test discord --event MESSAGE_CREATE --fixture ./test/fixtures/dm-events/discord-dm.json
 *   brat integration test slack --event message --fixture ./test/fixtures/dm-events/slack-dm.json --verbose
 *   brat integration test twitch --event whisper --fixture ./test/fixtures/dm-events/twitch-whisper.json --format json
 */

import { Flags, Args } from '@oclif/core';
import { BratCommand } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigRegistry } from '../../../../../src/services/ingress/core/config-registry';
import { TranslationEngine } from '../../../../../src/services/ingress/core/translation-engine';
import type { InternalEventV2 } from '../../../../../src/types/events';

interface TestResult {
  success: boolean;
  platform: string;
  platformEvent: string;
  fixtureSize: number;
  eventType?: string;
  filterPassed?: boolean;
  builderType?: 'generic' | 'custom';
  fieldExtractions?: Record<string, { value: any; source: string }>;
  envelope?: InternalEventV2;
  error?: string;
}

export default class IntegrationTest extends BratCommand {
  static description = 'Test platform ingress event normalization using fixtures';

  static examples = [
    '<%= config.bin %> <%= command.id %> discord --event MESSAGE_CREATE --fixture ./test/fixtures/dm-events/discord-dm.json',
    '<%= config.bin %> <%= command.id %> slack --event message --fixture ./test/fixtures/dm-events/slack-dm.json --verbose',
    '<%= config.bin %> <%= command.id %> twitch --event whisper --fixture ./test/fixtures/dm-events/twitch-whisper.json --format json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    event: Flags.string({
      description: 'Platform event name (e.g., MESSAGE_CREATE, message, whisper)',
      required: true,
    }),
    fixture: Flags.string({
      description: 'Path to fixture file (JSON)',
      required: true,
    }),
    verbose: Flags.boolean({
      description: 'Show detailed field extraction information',
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
      description: 'Platform to test (discord, slack, twitch, etc.)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationTest);

    const platform = args.platform;
    const platformEvent = flags.event;
    const fixturePath = flags.fixture;

    this.logger.debug(`Testing ${platform}:${platformEvent} with fixture ${fixturePath}`);

    try {
      // Load fixture
      const fixtureAbsPath = path.isAbsolute(fixturePath)
        ? fixturePath
        : path.join(this.repoRoot, fixturePath);

      const fixtureContent = await fs.readFile(fixtureAbsPath, 'utf-8');
      const fixtureData = JSON.parse(fixtureContent);
      const fixtureSize = fixtureContent.length;

      this.logger.debug(`Fixture loaded: ${fixtureSize} bytes`);

      // Initialize ConfigRegistry
      const configPath = path.join(this.repoRoot, 'config');
      const registry = new ConfigRegistry({ configPath, validateSchema: false });
      await registry.load();

      this.logger.debug('ConfigRegistry loaded');

      // Create TranslationEngine
      const engine = new TranslationEngine(registry);

      // Translate the event
      const envelope = await engine.translateInbound(platform, platformEvent, fixtureData);

      // Get mapping for detailed info
      const mapping = registry.findByPlatformEvent(platform, platformEvent, fixtureData);

      // Build result
      const result: TestResult = {
        success: true,
        platform,
        platformEvent,
        fixtureSize,
        eventType: envelope.type,
        filterPassed: mapping ? true : false,
        builderType: 'generic', // TranslationEngine logs this, but we default to generic
        envelope,
      };

      // Extract field information if verbose
      if (flags.verbose && mapping) {
        result.fieldExtractions = this.extractFieldInfo(fixtureData, mapping.fieldMapping);
      }

      // Output results
      if (flags.format === 'json') {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.outputTextResult(result, flags.verbose);
      }
    } catch (error: any) {
      const result: TestResult = {
        success: false,
        platform,
        platformEvent,
        fixtureSize: 0,
        error: error.message,
      };

      if (flags.format === 'json') {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log(`\n❌ Test failed: ${error.message}`);
      }

      this.error('Test failed', { exit: 1 });
    }
  }

  /**
   * Extract field information from fixture data using field mapping
   */
  private extractFieldInfo(
    fixtureData: any,
    fieldMapping: any
  ): Record<string, { value: any; source: string }> {
    const extractions: Record<string, { value: any; source: string }> = {};

    for (const [field, pathOrConfig] of Object.entries(fieldMapping)) {
      if (field === 'custom' || field === 'eventWrapper') continue;

      let value: any;
      let source = '';

      if (typeof pathOrConfig === 'string') {
        // Simple string path
        value = this.getValueAtPath(fixtureData, pathOrConfig);
        source = pathOrConfig;
      } else if (typeof pathOrConfig === 'object' && pathOrConfig !== null) {
        // Object with path and fallbacks
        const config = pathOrConfig as any;
        if (config.path) {
          value = this.getValueAtPath(fixtureData, config.path);
          source = config.path;

          // Try fallbacks if main path failed
          if (value === undefined && config.fallbacks) {
            for (const fallback of config.fallbacks) {
              value = this.getValueAtPath(fixtureData, fallback);
              if (value !== undefined) {
                source = `${config.path} (fallback: ${fallback})`;
                break;
              }
            }
          }
        }
      }

      if (value !== undefined) {
        extractions[field] = { value, source };
      }
    }

    return extractions;
  }

  /**
   * Get value from object at dot-notation path
   */
  private getValueAtPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Output test result in human-readable format
   */
  private outputTextResult(result: TestResult, verbose: boolean): void {
    this.log(`\n${result.platform.toUpperCase()} - ${result.platformEvent}`);
    this.log('='.repeat(50));

    if (!result.success) {
      this.log(`❌ Test failed: ${result.error}`);
      return;
    }

    this.log(`✅ Fixture loaded: ${result.fixtureSize} bytes`);
    this.log(`✅ Event matched: ${result.eventType}`);
    this.log(`✅ Filter passed: ${result.filterPassed ? 'Yes' : 'No'}`);
    this.log(`✅ Builder type: ${result.builderType}`);

    // Show field extractions if verbose
    if (verbose && result.fieldExtractions) {
      this.log(`\nField Extraction:`);
      for (const [field, info] of Object.entries(result.fieldExtractions)) {
        const displayValue =
          typeof info.value === 'string'
            ? `"${info.value}"`
            : JSON.stringify(info.value);
        this.log(`  ${field}: ${displayValue} (${info.source})`);
      }
    }

    // Show envelope structure (key fields only)
    if (result.envelope) {
      this.log(`\nNormalized Event (InternalEventV2):`);
      this.log(`  Type: ${result.envelope.type}`);
      this.log(`  Correlation ID: ${result.envelope.correlationId}`);
      this.log(`  Ingress At: ${result.envelope.ingress.ingressAt}`);

      if (result.envelope.identity?.external?.id) {
        this.log(`  User ID: ${result.envelope.identity.external.id}`);
      }

      if (result.envelope.identity?.external?.displayName) {
        this.log(`  Display Name: ${result.envelope.identity.external.displayName}`);
      }

      if (result.envelope.message?.text) {
        const text =
          result.envelope.message.text.length > 50
            ? result.envelope.message.text.substring(0, 50) + '...'
            : result.envelope.message.text;
        this.log(`  Message: "${text}"`);
      }

      if (result.envelope.ingress?.channel) {
        this.log(`  Channel ID: ${result.envelope.ingress.channel}`);
      }
    }

    this.log(`\n✅ Normalized to InternalEventV2 successfully`);
  }
}
