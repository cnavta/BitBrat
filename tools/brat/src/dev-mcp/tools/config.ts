/**
 * Config Tools
 *
 * MCP tools for inspecting and validating platform configuration.
 * Provides read-only access to architecture.yaml and validation utilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ToolDefinition } from '../types.js';

/**
 * Find architecture.yaml by walking up from current directory
 */
function findArchitectureYaml(): string {
  let currentDir = process.cwd();
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const archPath = path.join(currentDir, 'architecture.yaml');
    if (fs.existsSync(archPath)) {
      return archPath;
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      // Reached root
      break;
    }
    currentDir = parent;
    depth++;
  }

  throw new Error('architecture.yaml not found in current directory or any parent directory');
}

/**
 * Load and parse architecture.yaml
 */
function loadArchitecture(): any {
  const archPath = findArchitectureYaml();
  const content = fs.readFileSync(archPath, 'utf8');
  const arch = yaml.load(content);

  if (!arch || typeof arch !== 'object') {
    throw new Error('Invalid architecture.yaml: could not parse as object');
  }

  return arch;
}

/**
 * config.show - Display full architecture.yaml content
 *
 * Returns the complete architecture.yaml as formatted YAML.
 */
export const configShowTool: ToolDefinition = {
  name: 'config.show',
  description: 'Display the full architecture.yaml configuration',
  inputSchema: z.object({
    format: z.enum(['yaml', 'json']).optional().describe('Output format (yaml or json)'),
  }),
  handler: async (args) => {
    try {
      const arch = loadArchitecture();
      const format = args.format || 'yaml';

      let output: string;
      if (format === 'json') {
        output = JSON.stringify(arch, null, 2);
      } else {
        output = yaml.dump(arch, { indent: 2, lineWidth: 120 });
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: output,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading architecture.yaml: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * config.validate - Validate architecture.yaml structure
 *
 * Checks for common issues:
 * - Missing required sections
 * - Invalid service definitions
 * - Profile/exposure contract violations
 */
export const configValidateTool: ToolDefinition = {
  name: 'config.validate',
  description: 'Validate architecture.yaml structure and detect common issues',
  inputSchema: z.object({}),
  handler: async () => {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      const arch = loadArchitecture();

      // Check required top-level sections
      const requiredSections = ['name', 'project', 'services', 'messaging'];
      for (const section of requiredSections) {
        if (!arch[section]) {
          issues.push(`Missing required section: ${section}`);
        }
      }

      // Validate services
      if (arch.services && typeof arch.services === 'object') {
        for (const [name, service] of Object.entries(arch.services)) {
          const svc = service as any;

          // Check required service fields
          if (!svc.entry) {
            issues.push(`Service '${name}': missing 'entry' field`);
          }

          // Validate profile/exposure contract
          const profile = svc.profile || 'core';
          const exposure = svc.mcp?.exposure || 'platform-only';

          // Enforce profile/exposure rules from technical architecture
          if (profile === 'mcp-server' && exposure !== 'platform+domain') {
            issues.push(
              `Service '${name}': profile 'mcp-server' requires exposure 'platform+domain', got '${exposure}'`
            );
          }

          if (profile === 'core' && exposure === 'platform+domain') {
            warnings.push(
              `Service '${name}': profile 'core' typically uses 'platform-only' exposure, got '${exposure}'`
            );
          }

          // Check for active services without port
          if (svc.active && !svc.port) {
            warnings.push(`Service '${name}': active service should have a 'port' defined`);
          }

          // Warn about inactive services
          if (svc.active === false) {
            warnings.push(`Service '${name}': marked as inactive`);
          }
        }
      }

      // Validate messaging topics
      if (arch.messaging?.topics && Array.isArray(arch.messaging.topics)) {
        for (const topic of arch.messaging.topics) {
          if (!topic.name) {
            issues.push('Topic missing required field: name');
            continue;
          }

          // Check topic naming convention
          const topicPattern = /^internal\.[a-z-]+\.[a-z-]+\.v\d+$/;
          if (!topicPattern.test(topic.name)) {
            warnings.push(
              `Topic '${topic.name}': does not follow naming convention 'internal.<domain>.<verb>.v<N>'`
            );
          }
        }
      }

      // Build result summary
      const summary = {
        valid: issues.length === 0,
        issuesCount: issues.length,
        warningsCount: warnings.length,
        issues,
        warnings,
      };

      const output = JSON.stringify(summary, null, 2);

      return {
        content: [
          {
            type: 'text' as const,
            text: output,
          },
        ],
        isError: issues.length > 0,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error validating architecture.yaml: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * config.doctor - Run environment diagnostics
 *
 * Checks for:
 * - Required environment variables
 * - File system permissions
 * - Required dependencies
 */
export const configDoctorTool: ToolDefinition = {
  name: 'config.doctor',
  description: 'Run environment diagnostics and check for common setup issues',
  inputSchema: z.object({}),
  handler: async () => {
    const checks: Array<{ name: string; status: 'ok' | 'warning' | 'error'; message?: string }> = [];

    try {
      // Check architecture.yaml exists and is readable
      try {
        findArchitectureYaml();
        checks.push({ name: 'architecture.yaml', status: 'ok' });
      } catch (error: any) {
        checks.push({ name: 'architecture.yaml', status: 'error', message: error.message });
      }

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      if (majorVersion >= 20) {
        checks.push({ name: 'node-version', status: 'ok', message: nodeVersion });
      } else {
        checks.push({
          name: 'node-version',
          status: 'warning',
          message: `${nodeVersion} (recommend Node 20+)`,
        });
      }

      // Check for common directories
      const dirs = [
        'src',
        'tools/brat',
        'documentation',
        'infrastructure',
      ];

      for (const dir of dirs) {
        const dirPath = path.join(process.cwd(), dir);
        if (fs.existsSync(dirPath)) {
          checks.push({ name: `directory-${dir}`, status: 'ok' });
        } else {
          checks.push({ name: `directory-${dir}`, status: 'warning', message: 'not found' });
        }
      }

      // Check package.json exists
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        checks.push({ name: 'package.json', status: 'ok' });
      } else {
        checks.push({ name: 'package.json', status: 'error', message: 'not found' });
      }

      // Check write permissions for .brat directory
      const bratDir = path.join(process.cwd(), '.brat');
      try {
        if (!fs.existsSync(bratDir)) {
          fs.mkdirSync(bratDir, { recursive: true });
        }
        // Try to write a test file
        const testFile = path.join(bratDir, '.doctor-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        checks.push({ name: '.brat-writable', status: 'ok' });
      } catch (error: any) {
        checks.push({ name: '.brat-writable', status: 'error', message: error.message });
      }

      // Summary
      const summary = {
        healthy: checks.every((c) => c.status !== 'error'),
        checks,
      };

      const output = JSON.stringify(summary, null, 2);

      return {
        content: [
          {
            type: 'text' as const,
            text: output,
          },
        ],
        isError: !summary.healthy,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error running diagnostics: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * schema.read - Read a specific schema from documentation/schemas/
 *
 * Provides access to envelope, routing-slip, and other schemas.
 */
export const schemaReadTool: ToolDefinition = {
  name: 'schema.read',
  description: 'Read a schema file from documentation/schemas/',
  inputSchema: z.object({
    name: z.string().describe('Schema name (e.g., "envelope.v1", "routing-slip.v1")'),
  }),
  handler: async (args) => {
    try {
      const schemaName = args.name;
      const schemaFile = schemaName.endsWith('.json') ? schemaName : `${schemaName}.json`;
      const schemaPath = path.join(process.cwd(), 'documentation', 'schemas', schemaFile);

      if (!fs.existsSync(schemaPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Schema not found: ${schemaFile}\nLooked in: ${schemaPath}`,
            },
          ],
          isError: true,
        };
      }

      const content = fs.readFileSync(schemaPath, 'utf8');

      return {
        content: [
          {
            type: 'text' as const,
            text: content,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading schema: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * All config tools
 */
export const configTools: ToolDefinition[] = [
  configShowTool,
  configValidateTool,
  configDoctorTool,
  schemaReadTool,
];
