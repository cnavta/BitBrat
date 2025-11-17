import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { RendererInput, RendererInputSchema, UrlMapYaml, UrlMapYamlSchema, beLink } from './schema';
import { loadArchitecture } from '../../config/loader';

export interface RenderOptions {
  rootDir: string;
  env: 'dev' | 'staging' | 'prod';
  projectId: string;
  outFile?: string;
}

/**
 * Build a minimal RendererInput from architecture.yaml for current sprint scope.
 * - Uses infrastructure.main-load-balancer.routing rules
 * - Maps service -> backend service be-<service>
 * - Bucket rules route to default backend for now
 */
export function loadRendererInputFromArchitecture(opts: { rootDir: string; env: 'dev'|'staging'|'prod'; projectId: string }): RendererInput {
  const arch: any = loadArchitecture(opts.rootDir);
  // Support both current and legacy locations of LB routing in architecture.yaml
  const lbNode = arch?.infrastructure?.resources?.['main-load-balancer']
    || arch?.infrastructure?.['main-load-balancer']
    || {};
  const routing = lbNode?.routing || {};
  const defaultDomain: string = routing?.default_domain || 'api.bitbrat.ai';
  const rules: any[] = Array.isArray(routing?.rules) ? routing.rules : [];
  const routes = rules.map((r: any) => ({
    pathPrefix: String(r.path_prefix || '/'),
    service: r.service ? String(r.service) : undefined,
    bucket: r.bucket ? String(r.bucket) : undefined,
    rewritePrefix: r.rewrite_prefix ? String(r.rewrite_prefix) : undefined,
  }));
  const input: RendererInput = RendererInputSchema.parse({
    projectId: opts.projectId,
    env: opts.env,
    defaultDomain,
    routes,
    defaultBackend: 'be-default',
  });
  return input;
}

export function renderUrlMapYaml(input: RendererInput): UrlMapYaml {
  const name = 'bitbrat-global-url-map';
  const projectId = input.projectId;
  const host = input.defaultDomain;
  const matcherName = 'default-matcher';

  const routeRules = input.routes.map((r, i) => {
    // Weighted backends: if canary provided, ensure weights sum to 100
    const weighted = (r.canary && r.canary.length)
      ? r.canary.map((c) => ({ backendService: beLink(projectId, c.backend), weight: c.weight }))
      : undefined;
    if (weighted) {
      const total = weighted.reduce((a, b) => a + b.weight, 0);
      if (total !== 100) {
        throw new Error(`Canary weights must sum to 100 (got ${total}) for path ${r.pathPrefix}`);
      }
    }

    const beName = r.service ? `be-${r.service}` : input.defaultBackend;

    const rr: any = {
      priority: i + 1,
      matchRules: [{ prefixMatch: r.pathPrefix }],
      routeAction: {},
    };
    if (r.rewritePrefix) {
      rr.routeAction.urlRewrite = { pathPrefixRewrite: r.rewritePrefix };
    }
    if (weighted) {
      rr.routeAction.weightedBackendServices = weighted;
    } else {
      rr.routeAction.weightedBackendServices = [{ backendService: beLink(projectId, beName), weight: 100 }];
    }
    return rr;
  });

  const yamlObj: UrlMapYaml = UrlMapYamlSchema.parse({
    name,
    defaultService: beLink(projectId, input.defaultBackend),
    hostRules: [{ hosts: [host], pathMatcher: matcherName }],
    pathMatchers: [{ name: matcherName, defaultService: beLink(projectId, input.defaultBackend), routeRules }],
  });
  return yamlObj;
}

export function writeYamlFile(obj: UrlMapYaml, outFile: string) {
  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  const text = yaml.dump(obj, { noRefs: true, sortKeys: true, lineWidth: 120 });
  fs.writeFileSync(outFile, text, 'utf8');
}

export function renderAndWrite(opts: RenderOptions): { outFile: string; yaml: UrlMapYaml } {
  const input = loadRendererInputFromArchitecture({ rootDir: opts.rootDir, env: opts.env, projectId: opts.projectId });
  const obj = renderUrlMapYaml(input);
  const out = opts.outFile || path.join(opts.rootDir, 'infrastructure', 'cdktf', 'lb', 'url-maps', opts.env, 'url-map.yaml');
  writeYamlFile(obj, out);
  return { outFile: out, yaml: obj };
}
