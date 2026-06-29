import { selectDeployableServices } from '../index';
import { ConfigurationError } from '../../orchestration/errors';
import type { ResolvedServiceConfig } from '../../config/loader';

function svc(name: string, active: boolean): ResolvedServiceConfig {
  return {
    name,
    region: 'us-central1',
    port: 3000,
    minInstances: 0,
    maxInstances: 1,
    cpu: '1',
    memory: '512Mi',
    allowUnauth: true,
    active,
    envKeys: [],
    secrets: [],
  };
}

describe('selectDeployableServices – deploy honors active:false', () => {
  const services = [svc('llm-bot', true), svc('obs-mcp', false), svc('ingress-egress', true)];

  it('omits inactive Bits from the --all deploy task list', () => {
    const selected = selectDeployableServices(services).map((s) => s.name);
    expect(selected).toEqual(['llm-bot', 'ingress-egress']);
    expect(selected).not.toContain('obs-mcp');
  });

  it('keeps active Bits selected unchanged', () => {
    const selected = selectDeployableServices(services).map((s) => s.name);
    expect(selected).toContain('llm-bot');
    expect(selected).toContain('ingress-egress');
  });

  it('selects an explicitly named active service', () => {
    const selected = selectDeployableServices(services, 'llm-bot').map((s) => s.name);
    expect(selected).toEqual(['llm-bot']);
  });

  it('fails fast with ConfigurationError when an explicit target is inactive', () => {
    expect(() => selectDeployableServices(services, 'obs-mcp')).toThrow(ConfigurationError);
    expect(() => selectDeployableServices(services, 'obs-mcp')).toThrow(/inactive/i);
  });

  it('fails with ConfigurationError when an explicit target is unknown', () => {
    expect(() => selectDeployableServices(services, 'does-not-exist')).toThrow(ConfigurationError);
    expect(() => selectDeployableServices(services, 'does-not-exist')).toThrow(/not found/i);
  });
});
