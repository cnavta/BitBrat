import { loadRendererInputFromArchitecture, renderUrlMapYaml } from '../../urlmap/renderer';

describe('URL Map renderer using repo architecture.yaml', () => {
  it('produces non-empty routes from architecture.yaml routing.rules', () => {
    const input = loadRendererInputFromArchitecture({ rootDir: process.cwd(), env: 'dev', projectId: 'demo-project' });
    expect(input.routes.length).toBeGreaterThan(0);
    const yamlObj = renderUrlMapYaml(input);
    const rules = yamlObj?.pathMatchers?.[0]?.routeRules || [];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });
});
