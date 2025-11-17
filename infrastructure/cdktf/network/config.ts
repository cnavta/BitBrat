import { z } from 'zod';

/**
 * NetworkConfig schema and types for the BitBrat Network stack
 * Source of truth: architecture.yaml
 */
export const EnvironmentSchema = z.enum(['dev', 'staging', 'prod']);

export const NetworkConfigSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  environment: EnvironmentSchema,
  regions: z.array(z.string().min(1)).nonempty('At least one region is required'),
  cidrBlocks: z.record(z.string().min(1), z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/, 'Must be a valid CIDR block')), // region -> CIDR
  enableFlowLogs: z.boolean().default(false),
});

export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;

/**
 * Simple helper to apply defaults post-parse.
 */
export function parseNetworkConfig(input: unknown): NetworkConfig {
  return NetworkConfigSchema.parse(input);
}
