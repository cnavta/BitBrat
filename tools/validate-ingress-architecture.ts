#!/usr/bin/env node
/**
 * Architecture Validation Tool for Ingress-Egress Framework
 *
 * Validates WebhookConnector implementations and ConnectorMetadata completeness.
 * Can be run as a standalone script or integrated into pre-commit hooks.
 *
 * Usage:
 *   npx ts-node tools/validate-ingress-architecture.ts
 *   node dist/tools/validate-ingress-architecture.js
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 *
 * @since Sprint 342 - IEF-010
 */

import * as fs from 'fs';
import * as path from 'path';

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

interface ValidationResult {
  passed: boolean;
  message: string;
  file?: string;
  line?: number;
}

interface ValidationSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  results: ValidationResult[];
}

class IngressArchitectureValidator {
  private summary: ValidationSummary = {
    totalChecks: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    results: []
  };

  private projectRoot: string;

  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
  }

  /**
   * Main validation entry point
   */
  async validate(): Promise<boolean> {
    console.log('================================================');
    console.log('Ingress Architecture Validation');
    console.log('================================================\n');

    // Run all validation checks
    await this.validateWebhookConnectorImplementations();
    await this.validateConnectorMetadataCompleteness();
    await this.detectDeprecatedPatterns();
    await this.validateExports();

    // Print summary
    this.printSummary();

    return this.summary.failed === 0;
  }

  /**
   * Find all connector adapter files
   */
  private findAdapterFiles(): string[] {
    const ingressDir = path.join(this.projectRoot, 'src/services/ingress');
    const adapters: string[] = [];

    if (!fs.existsSync(ingressDir)) {
      return adapters;
    }

    const platforms = fs.readdirSync(ingressDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => name !== 'core' && name !== '__tests__');

    for (const platform of platforms) {
      const adapterPath = path.join(ingressDir, platform, 'connector-adapter.ts');
      if (fs.existsSync(adapterPath)) {
        adapters.push(path.relative(this.projectRoot, adapterPath));
      }
    }

    return adapters;
  }

  /**
   * Validate all WebhookConnector implementations
   */
  private async validateWebhookConnectorImplementations(): Promise<void> {
    console.log('Validating WebhookConnector implementations...\n');

    // Find all connector adapter files
    const adapterFiles = this.findAdapterFiles();

    for (const file of adapterFiles) {
      const fullPath = path.join(this.projectRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const platform = path.basename(path.dirname(file));

      // Check if implements WebhookConnector
      if (!content.includes('implements') || !content.includes('WebhookConnector')) {
        this.addWarning(
          `${platform} connector does not implement WebhookConnector interface`,
          file
        );
        continue;
      }

      // Validate required methods
      this.validateMethod(content, file, platform, 'verifySignature');
      this.validateMethod(content, file, platform, 'handleWebhook');
      this.validateMethod(content, file, platform, 'getMetadata');
    }
  }

  /**
   * Validate a method exists in the file
   */
  private validateMethod(content: string, file: string, platform: string, methodName: string): void {
    const methodPattern = new RegExp(`\\b${methodName}\\s*\\(`);

    if (methodPattern.test(content)) {
      this.addPass(
        `${platform} implements ${methodName}()`,
        file
      );
    } else {
      this.addFail(
        `${platform} missing required method: ${methodName}()`,
        file
      );
    }
  }

  /**
   * Validate ConnectorMetadata completeness
   */
  private async validateConnectorMetadataCompleteness(): Promise<void> {
    console.log('\nValidating ConnectorMetadata completeness...\n');

    const adapterFiles = this.findAdapterFiles();

    for (const file of adapterFiles) {
      const fullPath = path.join(this.projectRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const platform = path.basename(path.dirname(file));

      // Check if getMetadata returns proper structure
      if (!content.includes('getMetadata()')) {
        continue;  // Already flagged in previous validation
      }

      // Validate metadata fields
      const requiredFields = [
        'platform',
        'version',
        'authMethod',
        'capabilities'
      ];

      // Extract getMetadata() body - match from getMetadata() { to the closing }
      const getMetadataStart = content.indexOf('getMetadata()');
      if (getMetadataStart === -1) {
        this.addFail(
          `${platform} getMetadata() implementation not found`,
          file
        );
        continue;
      }

      // Find the opening brace
      const openBrace = content.indexOf('{', getMetadataStart);
      if (openBrace === -1) continue;

      // Find the matching closing brace (simple approach: find the return statement end)
      const returnStart = content.indexOf('return', openBrace);
      if (returnStart === -1) continue;

      // Extract until we find the method end (next method or class end)
      const nextMethodOrEnd = Math.min(
        content.indexOf('\n  }', returnStart + 1) !== -1 ? content.indexOf('\n  }', returnStart + 1) : content.length,
        content.indexOf('\n\n  ', returnStart + 1) !== -1 ? content.indexOf('\n\n  ', returnStart + 1) : content.length
      );

      const metadataBody = content.substring(openBrace, nextMethodOrEnd);

      for (const field of requiredFields) {
        if (metadataBody.includes(`${field}:`)) {
          this.addPass(
            `${platform} metadata includes '${field}'`,
            file
          );
        } else {
          this.addFail(
            `${platform} metadata missing required field: '${field}'`,
            file
          );
        }
      }

      // Validate capabilities structure
      const hasCapabilities = metadataBody.includes('capabilities:');
      const hasIngressEgress = (metadataBody.includes('ingress:') || metadataBody.includes('ingress {')) &&
                                (metadataBody.includes('egress:') || metadataBody.includes('egress {'));

      if (hasCapabilities && hasIngressEgress) {
        this.addPass(
          `${platform} metadata includes ingress/egress capabilities`,
          file
        );
      } else {
        this.addFail(
          `${platform} metadata missing ingress/egress capabilities`,
          file
        );
      }
    }
  }

  /**
   * Detect deprecated patterns
   */
  private async detectDeprecatedPatterns(): Promise<void> {
    console.log('\nDetecting deprecated patterns...\n');

    // Check for inline signature verification (should use verifySignature method)
    const serviceFile = path.join(this.projectRoot, 'src/apps/ingress-egress-service.ts');
    if (fs.existsSync(serviceFile)) {
      const content = fs.readFileSync(serviceFile, 'utf-8');

      // Look for inline validateTwilioSignature calls (deprecated pattern)
      const lines = content.split('\n');
      let foundDeprecatedPattern = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for direct signature validation in route handlers (skip imports and comments)
        if (line.includes('validateTwilioSignature') &&
            !line.includes('import') &&
            !line.includes('//') &&
            !line.includes('verifySignature')) {

          // Look back to see if we're in the deprecated route (30 lines should cover most route handlers)
          const contextStart = Math.max(0, i - 30);
          const context = lines.slice(contextStart, i).join('\n');

          if (!context.includes('DEPRECATED')) {
            this.addFail(
              'Found inline signature verification (should use WebhookConnector.verifySignature)',
              'src/apps/ingress-egress-service.ts',
              i + 1
            );
            foundDeprecatedPattern = true;
          }
        }
      }

      if (!foundDeprecatedPattern) {
        this.addPass(
          'No deprecated inline signature verification patterns found',
          'src/apps/ingress-egress-service.ts'
        );
      }
    }

    // Check for old route patterns (should be marked deprecated)
    const oldRoutePattern = /onHTTPRequest.*\/webhooks\/twilio[^:]/;
    if (fs.existsSync(serviceFile)) {
      const content = fs.readFileSync(serviceFile, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (oldRoutePattern.test(lines[i])) {
          // Check if marked deprecated within 5 lines above
          const contextStart = Math.max(0, i - 5);
          const context = lines.slice(contextStart, i).join('\n');

          if (context.includes('DEPRECATED')) {
            this.addPass(
              'Old Twilio route properly marked as DEPRECATED',
              'src/apps/ingress-egress-service.ts',
              i + 1
            );
          } else {
            this.addWarning(
              'Found old Twilio route without DEPRECATED marker',
              'src/apps/ingress-egress-service.ts',
              i + 1
            );
          }
        }
      }
    }
  }

  /**
   * Validate exports from core/index.ts
   */
  private async validateExports(): Promise<void> {
    console.log('\nValidating core exports...\n');

    const indexFile = path.join(this.projectRoot, 'src/services/ingress/core/index.ts');

    if (!fs.existsSync(indexFile)) {
      this.addFail(
        'Core index.ts not found',
        'src/services/ingress/core/index.ts'
      );
      return;
    }

    const content = fs.readFileSync(indexFile, 'utf-8');

    const requiredExports = [
      'interfaces',
      'connector-manager',
      'webhook-handler'
    ];

    for (const exportName of requiredExports) {
      if (content.includes(`from './${exportName}'`)) {
        this.addPass(
          `Core exports '${exportName}'`,
          'src/services/ingress/core/index.ts'
        );
      } else {
        this.addFail(
          `Core missing export for '${exportName}'`,
          'src/services/ingress/core/index.ts'
        );
      }
    }
  }

  /**
   * Add a passing validation result
   */
  private addPass(message: string, file?: string, line?: number): void {
    this.summary.totalChecks++;
    this.summary.passed++;
    this.summary.results.push({ passed: true, message, file, line });
    console.log(`${GREEN}✓${RESET} ${message}`);
  }

  /**
   * Add a failing validation result
   */
  private addFail(message: string, file?: string, line?: number): void {
    this.summary.totalChecks++;
    this.summary.failed++;
    this.summary.results.push({ passed: false, message, file, line });
    const location = file ? ` (${file}${line ? `:${line}` : ''})` : '';
    console.log(`${RED}✗${RESET} ${message}${location}`);
  }

  /**
   * Add a warning (doesn't fail validation)
   */
  private addWarning(message: string, file?: string, line?: number): void {
    this.summary.totalChecks++;
    this.summary.warnings++;
    this.summary.results.push({ passed: true, message, file, line });
    const location = file ? ` (${file}${line ? `:${line}` : ''})` : '';
    console.log(`${YELLOW}⚠${RESET} ${message}${location}`);
  }

  /**
   * Print validation summary
   */
  private printSummary(): void {
    console.log('\n================================================');
    console.log('Validation Summary');
    console.log('================================================\n');

    console.log(`Total Checks: ${this.summary.totalChecks}`);
    console.log(`${GREEN}Passed: ${this.summary.passed}${RESET}`);
    console.log(`${YELLOW}Warnings: ${this.summary.warnings}${RESET}`);
    console.log(`${RED}Failed: ${this.summary.failed}${RESET}\n`);

    if (this.summary.failed === 0) {
      console.log(`${GREEN}✓ All validations passed${RESET}\n`);
    } else {
      console.log(`${RED}✗ Validation failed${RESET}\n`);
      console.log('Failed checks:');
      this.summary.results
        .filter(r => !r.passed)
        .forEach(r => {
          const location = r.file ? ` (${r.file}${r.line ? `:${r.line}` : ''})` : '';
          console.log(`  - ${r.message}${location}`);
        });
      console.log('');
    }
  }
}

// Main execution
async function main() {
  const validator = new IngressArchitectureValidator();
  const success = await validator.validate();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Validation error:', err);
    process.exit(1);
  });
}

export { IngressArchitectureValidator };
