import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

import { renderUrlMapYaml, renderAndWrite } from '../renderer';
import { RendererInput } from '../schema';

function makeInput(overrides: Partial<RendererInput> = {}): RendererInput {
  const base: RendererInput = {
    projectId: 'demo-project',
    env: 'dev',
    defaultDomain: 'api.bitbrat.ai',
    routes: [],
    defaultBackend: 'be-default',
  };
  return { ...base, ...overrides } as RendererInput;
}

describe('URL Map renderer — routing-driven with buckets', () => {
  it('service-only routing maps to be-<service> and selects first service as default', () => {
    const input = makeInput({
      routes: [
        { pathPrefix: '/oauth', service: 'oauth-flow', rewritePrefix: '/' },
        { pathPrefix: '/api', service: 'ingress-egress' },
      ],
      defaultBackend: 'be-oauth-flow',
    });
    const out = renderUrlMapYaml(input);

    const pm = out.pathMatchers?.[0];
    expect(out.defaultService).toContain('/backendServices/be-oauth-flow');
    const rrs = pm?.routeRules || [];
    expect(rrs.length).toBe(2);
    const wb0 = rrs[0]?.routeAction?.weightedBackendServices || [];
    expect(wb0[0].backendService).toContain('/backendServices/be-oauth-flow');
    const wb1 = rrs[1]?.routeAction?.weightedBackendServices || [];
    expect(wb1[0].backendService).toContain('/backendServices/be-ingress-egress');
    // rewrite for service rule should honor provided rewritePrefix
    expect(rrs[0]?.routeAction?.urlRewrite?.pathPrefixRewrite).toBe('/');
  });

  it('bucket-only routing maps to be-assets-proxy and injects urlRewrite with bucket key', () => {
    const input = makeInput({
      routes: [
        { pathPrefix: '/assets', bucket: 'public-assets', rewritePrefix: '/static' },
      ],
      defaultBackend: 'be-assets-proxy',
    });
    const out = renderUrlMapYaml(input);
    const rr = out.pathMatchers?.[0]?.routeRules?.[0] as any;
    const wb = rr.routeAction.weightedBackendServices?.[0];
    expect(wb.backendService).toContain('/backendServices/be-assets-proxy');
    expect(rr.routeAction.urlRewrite?.pathPrefixRewrite).toBe('/bucket/public-assets/static');
  });

  it('mixed routing supports both service and bucket targets', () => {
    const input = makeInput({
      routes: [
        { pathPrefix: '/api', service: 'ingress-egress' },
        { pathPrefix: '/assets', bucket: 'site-assets' },
      ],
      defaultBackend: 'be-ingress-egress',
    });
    const out = renderUrlMapYaml(input);
    const rrs = out.pathMatchers?.[0]?.routeRules || [];
    const wb0 = rrs[0]?.routeAction?.weightedBackendServices?.[0];
    const wb1 = rrs[1]?.routeAction?.weightedBackendServices?.[0];
    expect(wb0 && wb0.backendService).toContain('/backendServices/be-ingress-egress');
    expect(wb1 && wb1.backendService).toContain('/backendServices/be-assets-proxy');
    expect(rrs[1]?.routeAction?.urlRewrite?.pathPrefixRewrite).toBe('/bucket/site-assets');
  });

  it('renderAndWrite writes to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-urlmap-out-'));
    // Create minimal architecture.yaml driving routing
    const arch = {
      infrastructure: {
        resources: {
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'main-lb',
            ip: '0.0.0.0',
            routing: {
              default_domain: 'api.example.com',
              rules: [ { path_prefix: '/assets', bucket: 'site-assets' } ],
              default_bucket: 'site-assets',
            },
          },
        },
      },
    } as any;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), yaml.dump(arch), 'utf8');

    const { outFile, yaml: ym } = renderAndWrite({ rootDir: tmp, env: 'dev', projectId: 'p1' });
    expect(outFile).toMatch(/infrastructure\/cdktf\/lb\/url-maps\/dev\/url-map.yaml$/);
    expect(fs.existsSync(outFile)).toBe(true);
    // Default backend should be be-assets-proxy due to default_bucket
    expect(ym.defaultService).toContain('/backendServices/be-assets-proxy');
  });
});
