import { renderUrlMapYaml } from '../renderer';
import { RendererInput } from '../schema';

function makeInput(overrides: Partial<RendererInput> = {}): RendererInput {
  const base: RendererInput = {
    projectId: 'demo-project',
    env: 'dev',
    defaultDomain: 'api.bitbrat.ai',
    routes: [
      { pathPrefix: '/oauth', service: 'oauth-flow', rewritePrefix: '/' },
      { pathPrefix: '/assets', service: 'ingress-egress' },
    ],
    defaultBackend: 'be-default',
  };
  return { ...base, ...overrides } as RendererInput;
}

describe('URL Map renderer', () => {
  it('renders deterministic YAML object with hostRules, pathMatchers and routeRules', () => {
    const input = makeInput();
    const out = renderUrlMapYaml(input);

    expect(out.name).toBe('bitbrat-global-url-map');
    expect(out.defaultService).toContain('/backendServices/be-default');
    expect(out.hostRules?.[0]?.hosts).toEqual(['api.bitbrat.ai']);
    expect(out.pathMatchers?.[0]?.name).toBe('default-matcher');

    const rr = out.pathMatchers?.[0]?.routeRules || [];
    expect(rr.length).toBe(2);
    expect(rr[0]).toMatchObject({
      priority: 1,
      matchRules: [{ prefixMatch: '/oauth' }],
      routeAction: { urlRewrite: { pathPrefixRewrite: '/' } },
    });
    // Weighted defaults to 100% to one backend when no canary provided
    const wb = rr[0]?.routeAction?.weightedBackendServices || [];
    expect(wb.length).toBe(1);
    expect(wb[0]).toMatchObject({ weight: 100 });
  });

  it('validates canary weights sum to 100', () => {
    const input = makeInput({
      routes: [
        {
          pathPrefix: '/v1/',
          service: 'oauth-flow',
          canary: [
            { backend: 'be-oauth-flow', weight: 60 },
            { backend: 'be-oauth-flow-canary', weight: 30 },
          ],
        },
      ],
    });
    expect(() => renderUrlMapYaml(input)).toThrow(/sum to 100/);
  });
});
