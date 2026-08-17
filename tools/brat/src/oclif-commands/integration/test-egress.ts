/**
 * oclif Command: integration test-egress
 * Sprint 13: DX-010
 *
 * Tests platform egress translation from InternalEventV2 to platform-specific payloads.
 * Loads an InternalEventV2 fixture, finds the egress mapping, and translates to
 * platform format showing method and arguments.
 *
 * Examples:
 *   brat integration test-egress discord --event dm.message.v1 --fixture ./test/fixtures/internal-dm.json
 *   brat integration test-egress slack --event chat.message.v1 --fixture ./test/fixtures/internal-chat.json --verbose
 */

import { Flags, Args } from '@oclif/core';
import { BratCommand } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigRegistry } from '../../../../../src/services/ingress/core/config-registry';
import type { InternalEventV2 } from '../../../../../src/types/events';

interface EgressTestResult {
  success: boolean;
  platform: string;
  eventType: string;
  fixtureSize: number;
  mappingFound: boolean;
  method?: string;
  payload?: Record<string, any>;
  fieldMappings?: Record<string, { value: any; source: string }>;
  error?: string;
}

export default class IntegrationTestEgress extends BratCommand {
  static description = 'Test platform egress translation from InternalEventV2 to platform payloads';

  static examples = [
    '<%= config.bin %> <%= command.id %> discord --event dm.message.v1 --fixture ./test/fixtures/internal-dm.json',
    '<%= config.bin %> <%= command.id %> slack --event chat.message.v1 --fixture ./test/fixtures/internal-chat.json --verbose',
    '<%= config.bin %> <%= command.id %> twitch --event dm.message.v1 --fixture ./test/fixtures/internal-dm.json --format json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    event: Flags.string({
      description: 'Internal event type (e.g., dm.message.v1, chat.message.v1)',
      required: true,
    }),
    fixture: Flags.string({
      description: 'Path to InternalEventV2 fixture file (JSON)',
      required: true,
    }),
    verbose: Flags.boolean({
      description: 'Show detailed field mapping information',
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
      description: 'Target platform (discord, slack, twitch, etc.)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationTestEgress);

    const platform = args.platform;
    const eventType = flags.event;
    const fixturePath = flags.fixture;

    this.logger.debug(`Testing egress: ${eventType} → ${platform} with fixture ${fixturePath}`);

    try {
      // Load fixture
      const fixtureAbsPath = path.isAbsolute(fixturePath)
        ? fixturePath
        : path.join(this.repoRoot, fixturePath);

      const fixtureContent = await fs.readFile(fixtureAbsPath, 'utf-8');
      const envelope: InternalEventV2 = JSON.parse(fixtureContent);
      const fixtureSize = fixtureContent.length;

      this.logger.debug(`Fixture loaded: ${fixtureSize} bytes`);

      // Validate it's an InternalEventV2
      if (!envelope.v || !envelope.correlationId || !envelope.type) {
        throw new Error('Fixture is not a valid InternalEventV2 envelope');
      }

      // Initialize ConfigRegistry
      const configPath = path.join(this.repoRoot, 'config');
      const registry = new ConfigRegistry({ configPath, validateSchema: false });
      await registry.load();

      this.logger.debug('ConfigRegistry loaded');

      // Find platform mapping for egress
      const mapping = this.findEgressMapping(registry, platform, eventType);

      if (!mapping) {
        throw new Error(`No egress mapping found for ${platform}:${eventType}`);
      }

      this.logger.debug(`Egress mapping found: ${mapping.method}`);

      // Translate to platform payload
      const { method, payload } = this.translateEgress(envelope, mapping);

      // Build result
      const result: EgressTestResult = {
        success: true,
        platform,
        eventType,
        fixtureSize,
        mappingFound: true,
        method,
        payload,
      };

      // Extract field mapping details if verbose
      if (flags.verbose && mapping.egress?.fieldMapping) {
        result.fieldMappings = this.extractFieldMappings(envelope, mapping.egress.fieldMapping);
      }

      // Output results
      if (flags.format === 'json') {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.outputTextResult(result, flags.verbose);
      }
    } catch (error: any) {
      const result: EgressTestResult = {
        success: false,
        platform,
        eventType,
        fixtureSize: 0,
        mappingFound: false,
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
   * Find egress mapping for platform and event type
   */
  private findEgressMapping(
    registry: ConfigRegistry,
    platform: string,
    eventType: string
  ): any {
    const platformMappings = (registry as any).platformMappings.get(platform);
    if (!platformMappings) return null;

    return platformMappings.find(
      (m: any) => m.internalEventType === eventType && m.egress
    );
  }

  /**
   * Translate InternalEventV2 to platform payload
   */
  private translateEgress(
    envelope: InternalEventV2,
    mapping: any
  ): { method: string; payload: Record<string, any> } {
    const method = mapping.egress?.method || 'sendText';
    const fieldMapping = mapping.egress?.fieldMapping || {};
    const payload: Record<string, any> = {};

    // Extract fields from envelope using field mapping
    for (const [targetField, sourcePath] of Object.entries(fieldMapping)) {
      if (typeof sourcePath === 'string') {
        const value = this.getValueAtPath(envelope, sourcePath);
        if (value !== undefined) {
          payload[targetField] = value;
        }
      }
    }

    return { method, payload };
  }

  /**
   * Extract field mapping details for verbose output
   */
  private extractFieldMappings(
    envelope: InternalEventV2,
    fieldMapping: any
  ): Record<string, { value: any; source: string }> {
    const mappings: Record<string, { value: any; source: string }> = {};

    for (const [targetField, sourcePath] of Object.entries(fieldMapping)) {
      if (typeof sourcePath === 'string') {
        const value = this.getValueAtPath(envelope, sourcePath);
        if (value !== undefined) {
          mappings[targetField] = { value, source: sourcePath };
        }
      }
    }

    return mappings;
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
  private outputTextResult(result: EgressTestResult, verbose: boolean): void {
    this.log(`\n${result.eventType.toUpperCase()} → ${result.platform.toUpperCase()}`);
    this.log('='.repeat(50));

    if (!result.success) {
      this.log(`❌ Test failed: ${result.error}`);
      return;
    }

    this.log(`✅ Fixture loaded: ${result.fixtureSize} bytes`);
    this.log(`✅ Event type: ${result.eventType}`);
    this.log(`✅ Platform: ${result.platform}`);
    this.log(`✅ Egress mapping found`);

    // Show field mappings if verbose
    if (verbose && result.fieldMappings) {
      this.log(`\nField Mapping:`);
      for (const [field, info] of Object.entries(result.fieldMappings)) {
        const displayValue =
          typeof info.value === 'string'
            ? `"${info.value}"`
            : JSON.stringify(info.value);
        this.log(`  ${field}: ${displayValue} (from ${info.source})`);
      }
    }

    // Show translated payload
    this.log(`\nTranslated to platform payload:`);
    this.log(`  Method: ${result.method}`);
    this.log(`  Arguments:`);

    if (result.payload) {
      for (const [key, value] of Object.entries(result.payload)) {
        const displayValue =
          typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
        this.log(`    ${key}: ${displayValue}`);
      }
    }

    this.log(`\n✅ Egress translation successful`);
  }
}
