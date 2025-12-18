import fs from 'fs';
import path from 'path';
import { BaseServer } from '../base-server';

describe('BaseServer.loadArchitectureYaml', () => {
  const yamlPath = path.resolve(process.cwd(), 'architecture.yaml');
  let originalYamlContent: string | null = null;

  beforeAll(() => {
    if (fs.existsSync(yamlPath)) {
      originalYamlContent = fs.readFileSync(yamlPath, 'utf8');
    }
  });

  afterAll(() => {
    // Restore original if we messed with it (though we shouldn't have)
    if (originalYamlContent !== null) {
      fs.writeFileSync(yamlPath, originalYamlContent);
    }
  });

  it('should load the real architecture.yaml from the project root', () => {
    const arch = BaseServer.loadArchitectureYaml();
    expect(arch).toBeDefined();
    expect(arch).not.toBeNull();
    expect(arch.name).toBe('BitBrat Platform');
  });

  it('should find the load balancer default domain', () => {
    const arch = BaseServer.loadArchitectureYaml();
    const domain = arch?.infrastructure?.resources?.['main-load-balancer']?.routing?.default_domain;
    expect(domain).toBeDefined();
    expect(domain).toContain('bitbrat.ai');
  });
});
