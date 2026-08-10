/**
 * Architecture.yaml v1 → v2 Migration Detector
 *
 * Detects schema version and generates migration guidance for upgrading
 * from v1 to v2 infrastructure model.
 *
 * Key differences:
 * - v1: Hardcoded infrastructure (infrastructure.gcp.resources)
 * - v2: Declarative three-tier model (platform → providers → contexts)
 *
 * @module validation/migration-detector
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export type SchemaVersion = 'v1' | 'v2' | 'unknown';

export interface MigrationIssue {
  severity: 'breaking' | 'warning' | 'info';
  path: string;
  message: string;
  v1Pattern?: string;
  v2Pattern?: string;
  action: string;
}

export interface MigrationReport {
  detectedVersion: SchemaVersion;
  targetVersion: 'v2';
  breaking: MigrationIssue[];
  warnings: MigrationIssue[];
  info: MigrationIssue[];
  estimatedEffort: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Detects architecture.yaml schema version
 */
export class MigrationDetector {
  private architecture: any;
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.architecture = this.loadArchitecture();
  }

  /**
   * Load architecture.yaml
   */
  private loadArchitecture(): any {
    const archPath = path.join(this.repoRoot, 'architecture.yaml');
    const content = fs.readFileSync(archPath, 'utf8');
    return yaml.parse(content);
  }

  /**
   * Detect schema version
   */
  detectVersion(): SchemaVersion {
    const arch = this.architecture;

    // v2 has platform.version = "2.0"
    if (arch.platform?.version === '2.0') {
      return 'v2';
    }

    // v2 has platform.infrastructure section
    if (arch.platform?.infrastructure) {
      return 'v2';
    }

    // v2 has infrastructure.docker with structured capabilities
    if (arch.infrastructure?.docker?.messaging && arch.infrastructure?.docker?.caching) {
      return 'v2';
    }

    // v2 has services with dependencies.infrastructure
    const hasInfraDeps = Object.values(arch.services || {}).some(
      (s: any) => Array.isArray(s.dependencies?.infrastructure)
    );
    if (hasInfraDeps) {
      return 'v2';
    }

    // v1 has infrastructure.gcp.resources (legacy pattern)
    if (arch.infrastructure?.gcp?.resources) {
      return 'v1';
    }

    // v1 has infrastructure.target (legacy pattern)
    if (arch.infrastructure?.target) {
      return 'v1';
    }

    // If none of the above, likely v1 or pre-v1
    if (arch.infrastructure || arch.services) {
      return 'v1';
    }

    return 'unknown';
  }

  /**
   * Generate migration report
   */
  generateMigrationReport(): MigrationReport {
    const version = this.detectVersion();
    const breaking: MigrationIssue[] = [];
    const warnings: MigrationIssue[] = [];
    const info: MigrationIssue[] = [];

    if (version === 'v2') {
      info.push({
        severity: 'info',
        path: 'architecture.yaml',
        message: 'Already using v2 schema',
        action: 'No migration needed',
      });

      return {
        detectedVersion: version,
        targetVersion: 'v2',
        breaking: [],
        warnings: [],
        info,
        estimatedEffort: '0 hours',
        riskLevel: 'low',
      };
    }

    // Check for missing platform.infrastructure section
    if (!this.architecture.platform?.infrastructure) {
      breaking.push({
        severity: 'breaking',
        path: 'platform.infrastructure',
        message: 'Missing platform.infrastructure section',
        v1Pattern: '(not present)',
        v2Pattern: 'platform.infrastructure: { messaging, caching, persistence }',
        action: 'Add platform.infrastructure section defining required capabilities',
      });
    }

    // Check for missing platform.version
    if (!this.architecture.platform?.version || this.architecture.platform.version !== '2.0') {
      breaking.push({
        severity: 'breaking',
        path: 'platform.version',
        message: 'Missing or incorrect platform.version',
        v1Pattern: this.architecture.platform?.version || '(not present)',
        v2Pattern: '"2.0"',
        action: 'Set platform.version to "2.0"',
      });
    }

    // Check for missing infrastructure.docker
    if (!this.architecture.infrastructure?.docker) {
      breaking.push({
        severity: 'breaking',
        path: 'infrastructure.docker',
        message: 'Missing infrastructure.docker provider',
        v1Pattern: '(not present)',
        v2Pattern: 'infrastructure.docker: { messaging, caching, persistence }',
        action: 'Add infrastructure.docker provider with capability implementations',
      });
    }

    // Check for legacy infrastructure.gcp.resources pattern
    if (this.architecture.infrastructure?.gcp?.resources) {
      breaking.push({
        severity: 'breaking',
        path: 'infrastructure.gcp.resources',
        message: 'Legacy infrastructure.gcp.resources pattern detected',
        v1Pattern: 'infrastructure.gcp.resources',
        v2Pattern: 'infrastructure.gcp: { messaging, caching, persistence }',
        action: 'Restructure GCP provider to use capability-based model',
      });
    }

    // Check for legacy infrastructure.target
    if (this.architecture.infrastructure?.target) {
      warnings.push({
        severity: 'warning',
        path: 'infrastructure.target',
        message: 'Legacy infrastructure.target field detected',
        v1Pattern: 'infrastructure.target',
        v2Pattern: 'executionContexts.*.infrastructure.provider',
        action: 'Move target specification to execution context infrastructure.provider',
      });
    }

    // Check services for missing infrastructure dependencies
    const servicesWithoutDeps: string[] = [];
    for (const [name, service] of Object.entries(this.architecture.services || {})) {
      const svc = service as any;
      if (svc.active && !svc.dependencies?.infrastructure) {
        servicesWithoutDeps.push(name);
      }
    }

    if (servicesWithoutDeps.length > 0) {
      warnings.push({
        severity: 'warning',
        path: `services.{${servicesWithoutDeps.slice(0, 3).join(', ')}}${servicesWithoutDeps.length > 3 ? ', ...' : ''}.dependencies.infrastructure`,
        message: `${servicesWithoutDeps.length} active service(s) missing infrastructure dependencies`,
        v1Pattern: '(not present)',
        v2Pattern: 'dependencies.infrastructure: ["messaging", "persistence"]',
        action: 'Add dependencies.infrastructure arrays to services that use infrastructure',
      });
    }

    // Check execution contexts for missing infrastructure.provider
    const contextsWithoutProvider: string[] = [];
    for (const [name, context] of Object.entries(this.architecture.executionContexts || {})) {
      const ctx = context as any;
      if (!ctx.infrastructure?.provider) {
        contextsWithoutProvider.push(name);
      }
    }

    if (contextsWithoutProvider.length > 0) {
      warnings.push({
        severity: 'warning',
        path: `executionContexts.{${contextsWithoutProvider.join(', ')}}.infrastructure.provider`,
        message: `${contextsWithoutProvider.length} execution context(s) missing infrastructure.provider`,
        v1Pattern: '(not present)',
        v2Pattern: 'infrastructure.provider: "docker"',
        action: 'Specify infrastructure provider for each execution context',
      });
    }

    // Estimate effort
    const breakingCount = breaking.length;
    const warningCount = warnings.length;
    let estimatedEffort = '1-2 hours';
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (breakingCount > 3 || warningCount > 5) {
      estimatedEffort = '3-4 hours';
      riskLevel = 'medium';
    }
    if (breakingCount > 5 || warningCount > 10) {
      estimatedEffort = '1-2 days';
      riskLevel = 'high';
    }

    return {
      detectedVersion: version,
      targetVersion: 'v2',
      breaking,
      warnings,
      info,
      estimatedEffort,
      riskLevel,
    };
  }

  /**
   * Format migration report as human-readable string
   */
  static formatMigrationReport(report: MigrationReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('='.repeat(80));
    lines.push('ARCHITECTURE.YAML MIGRATION REPORT');
    lines.push('='.repeat(80));
    lines.push('');

    lines.push(`Detected Version: ${report.detectedVersion}`);
    lines.push(`Target Version: ${report.targetVersion}`);
    lines.push(`Estimated Effort: ${report.estimatedEffort}`);
    lines.push(`Risk Level: ${report.riskLevel.toUpperCase()}`);
    lines.push('');

    if (report.detectedVersion === 'v2') {
      lines.push('✅ Already using v2 schema - no migration needed!');
      lines.push('');
      return lines.join('\n');
    }

    if (report.breaking.length > 0) {
      lines.push(`🔴 BREAKING CHANGES (${report.breaking.length}):`);
      lines.push('');
      for (const issue of report.breaking) {
        lines.push(`  Path: ${issue.path}`);
        lines.push(`  Issue: ${issue.message}`);
        if (issue.v1Pattern) {
          lines.push(`  v1 Pattern: ${issue.v1Pattern}`);
        }
        if (issue.v2Pattern) {
          lines.push(`  v2 Pattern: ${issue.v2Pattern}`);
        }
        lines.push(`  Action: ${issue.action}`);
        lines.push('');
      }
    }

    if (report.warnings.length > 0) {
      lines.push(`⚠️  WARNINGS (${report.warnings.length}):`);
      lines.push('');
      for (const issue of report.warnings) {
        lines.push(`  Path: ${issue.path}`);
        lines.push(`  Issue: ${issue.message}`);
        lines.push(`  Action: ${issue.action}`);
        lines.push('');
      }
    }

    if (report.info.length > 0) {
      lines.push(`ℹ️  INFO (${report.info.length}):`);
      lines.push('');
      for (const issue of report.info) {
        lines.push(`  ${issue.message}`);
        lines.push('');
      }
    }

    lines.push('📋 MIGRATION PATH:');
    lines.push('');
    lines.push('  1. Add platform.infrastructure section with capabilities');
    lines.push('  2. Add infrastructure.docker provider implementations');
    lines.push('  3. Add services.*.dependencies.infrastructure declarations');
    lines.push('  4. Add executionContexts.*.infrastructure.provider specifications');
    lines.push('  5. Run: brat config validate --schema v2');
    lines.push('  6. Test deployment: brat deploy services --all --context local');
    lines.push('');

    lines.push('📚 DOCUMENTATION:');
    lines.push('  - Migration guide: planning/sprint-6-foundation/migration-workflow.md');
    lines.push('  - v2 Schema: documentation/schemas/architecture.v2.json');
    lines.push('  - Examples: See current architecture.yaml for reference');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Standalone migration detection function
 */
export function detectMigration(repoRoot: string): MigrationReport {
  const detector = new MigrationDetector(repoRoot);
  return detector.generateMigrationReport();
}
