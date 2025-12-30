import { z } from 'zod';

// High-level inputs for renderer
export const RendererInputSchema = z.object({
  name: z.string().default('bitbrat-global-url-map'),
  projectId: z.string().min(1),
  env: z.enum(['dev', 'staging', 'prod']).default('dev'),
  defaultDomain: z.string().min(1),
  // routes derived from architecture.yaml
  routes: z.array(z.object({
    pathPrefix: z.string().min(1),
    service: z.string().optional(),
    bucket: z.string().optional(),
    rewritePrefix: z.string().optional(),
    headerMatches: z.array(z.object({
      headerName: z.string(),
      exactMatch: z.string().optional(),
      prefixMatch: z.string().optional(),
      presentMatch: z.boolean().optional(),
    })).optional(),
    canary: z.array(z.object({
      backend: z.string(),
      weight: z.number().int().min(0).max(100),
    })).optional(),
  })).default([]),
  defaultBackend: z.string().default('be-default'),
});
export type RendererInput = z.infer<typeof RendererInputSchema>;

// URL Map YAML shape (subset needed for import)
export const UrlMapYamlSchema = z.object({
  name: z.string(),
  defaultService: z.string(),
  hostRules: z.array(z.object({
    hosts: z.array(z.string()),
    pathMatcher: z.string(),
  })).default([]),
  pathMatchers: z.array(z.object({
    name: z.string(),
    defaultService: z.string(),
    routeRules: z.array(z.object({
      priority: z.number().int().min(0),
      matchRules: z.array(z.object({
        prefixMatch: z.string().optional(),
        headerMatches: z.array(z.object({
          headerName: z.string(),
          exactMatch: z.string().optional(),
          prefixMatch: z.string().optional(),
          presentMatch: z.boolean().optional(),
        })).optional(),
      })).default([]),
      routeAction: z.object({
        urlRewrite: z.object({
          pathPrefixRewrite: z.string().optional(),
        }).partial().optional(),
        weightedBackendServices: z.array(z.object({
          backendService: z.string(),
          weight: z.number().int().min(0).max(100),
        })).optional(),
      }).partial(),
    })).default([]),
  })).default([]),
}).strict();
export type UrlMapYaml = z.infer<typeof UrlMapYamlSchema>;

export function beLink(projectId: string, beName: string): string {
  return `https://www.googleapis.com/compute/v1/projects/${projectId}/global/backendServices/${beName}`;
}
