import fs from 'fs';
import path from 'path';
import { Bit } from '../base-server';

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
    const arch = Bit.loadArchitectureYaml();
    expect(arch).toBeDefined();
    expect(arch).not.toBeNull();
    expect(arch.name).toBe('BitBrat Platform');
  });

  it('should find platform orchestration configuration', () => {
    const arch = Bit.loadArchitectureYaml();
    const orchestration = arch?.platform?.orchestration;
    expect(orchestration).toBeDefined();
    expect(orchestration?.config?.model).toBe('event-driven');
    expect(orchestration?.stages).toBeDefined();
    expect(orchestration?.stages?.length).toBeGreaterThan(0);
  });
});
