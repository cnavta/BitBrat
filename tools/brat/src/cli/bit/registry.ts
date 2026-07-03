/**
 * Architecture.yaml registration for brat bit create command
 * Sprint 331: BL-331-104
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Logger } from '../../orchestration/logger';

/**
 * Options for registering a Bit in architecture.yaml
 */
export interface RegistrationOptions {
  name: string;
  profile: string;
  exposure: string;
  kind: string;
  entry: string;
  port: number;
  description: string;
  active: boolean;
  stage?: string;
}

/**
 * Registers a new Bit in architecture.yaml
 */
export async function registerBitInArchitecture(
  opts: RegistrationOptions,
  root: string,
  logger: Logger
): Promise<void> {
  const archPath = path.join(root, 'architecture.yaml');

  // Load architecture.yaml
  if (!fs.existsSync(archPath)) {
    throw new Error(`architecture.yaml not found at ${archPath}`);
  }

  const archContent = fs.readFileSync(archPath, 'utf8');
  const arch: any = yaml.load(archContent);

  if (!arch || typeof arch !== 'object') {
    throw new Error('Invalid architecture.yaml: could not parse as object');
  }

  // Ensure services object exists
  if (!arch.services) {
    arch.services = {};
  }

  // Check if service already exists
  if (arch.services[opts.name]) {
    throw new Error(
      `Service '${opts.name}' already exists in architecture.yaml. ` +
      `Use --force to overwrite files, but manual removal from architecture.yaml is required.`
    );
  }

  // Create service entry
  const serviceEntry: any = {
    profile: opts.profile,
    mcp: {
      exposure: opts.exposure,
    },
    active: opts.active,
    description: opts.description,
    kind: opts.kind,
    entry: opts.entry,
    port: opts.port,
  };

  // Add optional stage if provided
  if (opts.stage) {
    serviceEntry.stage = opts.stage;
  }

  // Insert service into architecture
  arch.services[opts.name] = serviceEntry;

  // Write back with formatting preservation
  const newContent = yaml.dump(arch, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false, // Preserve original key order
  });

  fs.writeFileSync(archPath, newContent, 'utf8');

  logger.info(
    { name: opts.name, profile: opts.profile, exposure: opts.exposure },
    'Registered Bit in architecture.yaml'
  );
}
