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

// Bit model (sprint-324): declarative capability profile + MCP control-plane exposure.
// Additive/optional so existing service definitions stay valid. Absent profile => 'core'.
export const BitProfileEnum = z.enum(['core', 'llm', 'mcp-server', 'gateway']);
export const BitCategoryEnum = z.enum(['platform', 'domain']);
export const McpExposureEnum = z.enum(['platform-only', 'platform+domain']);
export const McpConfigSchema = z.object({
  exposure: McpExposureEnum.optional(),
}).optional();

export const ServiceSchema = z.object({
  active: z.boolean().optional(),
  category: BitCategoryEnum.optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  entry: z.string().optional(),
  region: z.string().optional(),
  port: z.number().int().optional(),
  scaling: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  security: z.object({ allowUnauthenticated: z.boolean().optional() }).optional(),
  // Bit model: declarative intent in the canonical file; code composes the matching profile
  // and gates the MCP control plane on `mcp.exposure` (default platform-only).
  profile: BitProfileEnum.optional(),
  mcp: McpConfigSchema,
  env: z.array(z.string()).optional(),
  secrets: z.array(z.string()).optional(),
});

export const DeploymentTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('docker-engine'),
    host: z.string(),
    env: z.string(),
    context: z.string().optional(),
    maxConcurrent: z.number().int().positive().optional(),
    remoteDir: z.string().optional(),
    gateway: z.object({
      url: z.string(),
      authToken: z.string().optional(),
    }).optional(),
    persistence: z.object({
      driver: z.enum(['postgres', 'firestore']),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      database: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional(),
  }),
]);

export const DefaultsServicesSchema = z.object({
  implementation: z.string().optional(),
  category: BitCategoryEnum.optional(),
  image: z.string().optional(),
  runtime: z.object({ node: z.string().optional() }).optional(),
  region: z.string().optional(),
  network: z.string().optional(),
  scaling: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
  observability: z.any().optional(),
  port: z.number().int().optional(),
  health: z.array(z.string()).optional(),
  topics: z.any().optional(),
  security: z.object({ allowUnauthenticated: z.boolean().optional() }).optional(),
  // Bit model: platform-wide defaults applied unless a service overrides them.
  profile: BitProfileEnum.optional(),
  mcp: McpConfigSchema,
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
  deploymentTargets: z.record(DeploymentTargetSchema).optional(),
  network: NetworkSchema.optional(),
  lb: LoadBalancerSchema.optional(),
  // Sprint 20 — infrastructure.resources schema (object-store + load-balancer)
  infrastructure: z
    .object({
      target: z.string().optional(),
      resources: z
        .record(
          z.discriminatedUnion('type', [
            // document-database (cloud-firestore) — primary persistence layer
            z
              .object({
                type: z.literal('document-database'),
                implementation: z.literal('cloud-firestore'),
                description: z.string().optional(),
                docs: z.string().optional(),
                rules: z.string().optional(),
                indexes: z.string().optional(),
                collections: z.record(z.string()).optional(),
              })
              .passthrough(),
            // object-store (cloud-storage)
            z
              .object({
                type: z.literal('object-store'),
                implementation: z.literal('cloud-storage'),
                description: z.string().optional(),
                access_policy: z.enum(['private', 'public', 'public-preview']).default('private'),
                location: z.string().optional(),
                versioning: z.boolean().optional(),
                lifecycle: z.any().optional(),
                labels: z.record(z.string()).optional(),
              })
              .passthrough(),
            // load-balancer (global-external-application-lb or regional-internal-application-lb)
            z
              .object({
                type: z.literal('load-balancer'),
                implementation: z.enum([
                  'global-external-application-lb',
                  'regional-internal-application-lb',
                ]),
                name: z.string(),
                ip: z.string(),
                description: z.string().optional(),
                routing: z
                  .object({
                    default_domain: z.string(),
                    default_bucket: z.string().optional(),
                    rules: z
                      .array(
                        z
                          .object({
                            path_prefix: z.string(),
                            rewrite_prefix: z.string().optional(),
                            service: z.string().optional(),
                            bucket: z.string().optional(),
                          })
                          .superRefine((rule, ctx) => {
                            const hasService = !!rule.service;
                            const hasBucket = !!rule.bucket;
                            if ((hasService && hasBucket) || (!hasService && !hasBucket)) {
                              ctx.addIssue({
                                code: z.ZodIssueCode.custom,
                                message: 'Each routing rule must specify exactly one of service or bucket',
                                path: [],
                              });
                            }
                          })
                      )
                      .default([]),
                  })
                  .strict(),
              })
              .passthrough(),
          ])
        )
        .default({}),
    })
    .optional(),
}).passthrough();

export type Architecture = z.infer<typeof ArchitectureSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type LoadBalancer = z.infer<typeof LoadBalancerSchema>;

/**
 * Sprint 20 — Parse and validate routing cross-references, gathering metadata and warnings.
 * Does not change runtime behavior of existing loaders; provided for tests and future synth stages.
 */
export interface ParsedArchitectureMetadata {
  referencedServiceIds: string[];
  referencedBucketKeys: string[];
}

export interface ParseArchitectureResult {
  arch: Architecture;
  metadata: ParsedArchitectureMetadata;
  warnings: string[];
}

export function parseArchitecture(raw: unknown): ParseArchitectureResult {
  const arch = ArchitectureSchema.parse(raw) as Architecture;
  const warnings: string[] = [];
  const referencedServices = new Set<string>();
  const referencedBuckets = new Set<string>();

  const serviceIds = new Set<string>(Object.keys(arch.services || {}));
  const servicesMap = arch.services || ({} as Record<string, Service>);

  const resources = arch.infrastructure?.resources || {} as Record<string, any>;
  const resourceEntries = Object.entries(resources);
  const lbResources = resourceEntries.filter(([, r]) => r?.type === 'load-balancer' && r?.implementation === 'global-external-application-lb');

  // Deprecation behavior: prefer routing-based LB over lb.services[] when both exist
  if ((arch.lb?.services?.length || 0) > 0 && lbResources.length > 0) {
    warnings.push('Deprecation: lb.services[] is ignored when a routing-driven load-balancer resource exists. Prefer infrastructure.resources.<lb>.routing.');
  }

  for (const [lbKey, lbRes] of lbResources) {
    const routing = lbRes.routing;
    if (!routing) continue;

    // Validate default_bucket reference (if present)
    if (routing.default_bucket) {
      const refKey = routing.default_bucket as string;
      const ref = resources[refKey];
      if (!ref) {
        throw new Error(`routing.default_bucket references missing resource '${refKey}' in load balancer '${lbKey}'.`);
      }
      if (!(ref.type === 'object-store' && ref.implementation === 'cloud-storage')) {
        throw new Error(`routing.default_bucket '${refKey}' must reference an object-store with implementation=cloud-storage.`);
      }
      referencedBuckets.add(refKey);
    }

    // Validate each rule
    const rules = routing.rules || [];
    rules.forEach((rule: any, idx: number) => {
      if (rule.service) {
        const sid = rule.service as string;
        if (!serviceIds.has(sid)) {
          throw new Error(`routing.rules[${idx}].service references unknown service '${sid}'.`);
        }
        // Warn on inactive service (non-fatal)
        const svc = servicesMap[sid];
        if (svc && (svc as any).active === false) {
          warnings.push(`Service '${sid}' is inactive but referenced by routing.rules[${idx}].service.`);
        }
        referencedServices.add(sid);
      }
      if (rule.bucket) {
        const bkey = rule.bucket as string;
        const ref = resources[bkey];
        if (!ref) {
          throw new Error(`routing.rules[${idx}].bucket references missing resource '${bkey}'.`);
        }
        if (!(ref.type === 'object-store' && ref.implementation === 'cloud-storage')) {
          throw new Error(`routing.rules[${idx}].bucket '${bkey}' must reference an object-store with implementation=cloud-storage.`);
        }
        referencedBuckets.add(bkey);
      }
    });
  }

  return {
    arch,
    metadata: {
      referencedServiceIds: Array.from(referencedServices),
      referencedBucketKeys: Array.from(referencedBuckets),
    },
    warnings,
  };
}
