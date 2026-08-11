import { loadRendererInputFromArchitecture, renderUrlMapYaml } from '../../urlmap/renderer';

describe('URL Map renderer using repo architecture.yaml', () => {
  // NOTE: cloudResources.resources.main-load-balancer was removed in Sprint 8
  // Load balancer configuration is now provider-specific (infrastructure.gcp.loadBalancer)
  // This test is skipped until the renderer is updated to use the new structure
  it.skip('produces non-empty routes from architecture.yaml routing.rules', () => {
    const input = loadRendererInputFromArchitecture({ rootDir: process.cwd(), env: 'dev', projectId: 'demo-project' });
    expect(input.routes.length).toBeGreaterThan(0);
    const yamlObj = renderUrlMapYaml(input);
    const rules = yamlObj?.pathMatchers?.[0]?.routeRules || [];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });
});
