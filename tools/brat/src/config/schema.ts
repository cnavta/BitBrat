import { z } from 'zod';

export const CloudRunDefaultsSchema = z.object({
  platform: z.string().optional(),
  minInstances: z.number().int().nonnegative().optional(),
  maxInstances: z.number().int().nonnegative().optional(),
  cpu: z.string().optional(),
  memory: z.string().optional(),
});

export const DeploymentDefaultsSchema = z.object({
  maxConcurrentDeployments: z.number().int().positive().default(1),
  region: z.string().default('us-central1'),
  'cloud-run': CloudRunDefaultsSchema.optional(),
});

export const ServiceSchema = z.object({
  description: z.string().optional(),
  entry: z.string().optional(),
  region: z.string().optional(),
  port: z.number().int().optional(),
  scaling: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  security: z.object({ allowUnauthenticated: z.boolean().optional() }).optional(),
  env: z.array(z.string()).optional(),
  secrets: z.array(z.string()).optional(),
});

export const DefaultsServicesSchema = z.object({
  implementation: z.string().optional(),
  runtime: z.object({ node: z.string().optional() }).optional(),
  region: z.string().optional(),
  network: z.string().optional(),
  scaling: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
  observability: z.any().optional(),
  port: z.number().int().optional(),
  health: z.array(z.string()).optional(),
  topics: z.any().optional(),
  security: z.object({ allowUnauthenticated: z.boolean().optional() }).optional(),
  env: z.array(z.string()).optional(),
});

// Network overlays schema (Sprint 15)
export const NetworkSubnetSchema = z.object({
  name: z.string().optional(),
  cidr: z.string(),
});

export const NetworkRemoteStateSchema = z.object({
  bucket: z.string(),
  prefix: z.string(),
});

export const NetworkSchema = z.object({
  regions: z.array(z.string()).nonempty().default(['us-central1']),
  subnets: z.record(NetworkSubnetSchema).optional(),
  enableFlowLogs: z.boolean().default(false),
  remoteState: NetworkRemoteStateSchema.optional(),
});

// Load Balancer inputs (Sprint 16)
export const LbIpModeEnum = z.enum(['create', 'use-existing']);
export const LbCertModeEnum = z.enum(['managed', 'use-existing']);

export const LbRunServiceRefSchema = z.object({
  name: z.string(),
  projectId: z.string().optional(),
});

export const LbServiceSpecSchema = z.object({
  name: z.string(),
  regions: z.array(z.string()).optional(),
  runService: LbRunServiceRefSchema.optional(),
});

export const LoadBalancerSchema = z.object({
  ipMode: LbIpModeEnum,
  ipName: z.string().optional(),
  certMode: LbCertModeEnum,
  certRef: z.string().optional(),
  services: z.array(LbServiceSpecSchema).default([]),
}).superRefine((val, ctx) => {
  if (val.certMode === 'use-existing' && !val.certRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'certRef is required when certMode is use-existing',
      path: ['certRef'],
    });
  }
});

export const ArchitectureSchema = z.object({
  name: z.string().optional(),
  defaults: z.object({ services: DefaultsServicesSchema }).optional(),
  services: z.record(ServiceSchema).default({}),
  deploymentDefaults: DeploymentDefaultsSchema.optional(),
  network: NetworkSchema.optional(),
  lb: LoadBalancerSchema.optional(),
}).passthrough();

export type Architecture = z.infer<typeof ArchitectureSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type LoadBalancer = z.infer<typeof LoadBalancerSchema>;
