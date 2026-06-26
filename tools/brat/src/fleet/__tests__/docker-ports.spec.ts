import {
  hostPortEnvVar,
  parseDockerPortMapping,
  resolveServiceHostPort,
  rewriteToLocalHostPort,
} from '../docker-ports';

describe('fleet docker-ports — hostPortEnvVar', () => {
  it('maps a service name to its <SERVICE>_HOST_PORT env var', () => {
    expect(hostPortEnvVar('tool-gateway')).toBe('TOOL_GATEWAY_HOST_PORT');
    expect(hostPortEnvVar('api-gateway')).toBe('API_GATEWAY_HOST_PORT');
    expect(hostPortEnvVar('auth')).toBe('AUTH_HOST_PORT');
  });
});

describe('fleet docker-ports — parseDockerPortMapping', () => {
  it('extracts the host port mapped to the requested container port', () => {
    const ports = '0.0.0.0:3006->3000/tcp, [::]:3006->3000/tcp';
    expect(parseDockerPortMapping(ports, 3000)).toBe(3006);
  });

  it('disambiguates among multiple container ports', () => {
    const ports = '0.0.0.0:4001->8080/tcp, 0.0.0.0:4002->3000/tcp';
    expect(parseDockerPortMapping(ports, 3000)).toBe(4002);
    expect(parseDockerPortMapping(ports, 8080)).toBe(4001);
  });

  it('falls back to the first mapping when the container port is unspecified or unmatched', () => {
    const ports = '0.0.0.0:5005->8080/tcp';
    expect(parseDockerPortMapping(ports)).toBe(5005);
    expect(parseDockerPortMapping(ports, 3000)).toBe(5005);
  });

  it('returns undefined when there is no tcp mapping', () => {
    expect(parseDockerPortMapping('')).toBeUndefined();
    expect(parseDockerPortMapping('8222/tcp')).toBeUndefined();
  });
});

describe('fleet docker-ports — resolveServiceHostPort', () => {
  it('prefers an explicit <SERVICE>_HOST_PORT env override (no docker probe)', () => {
    const discover = jest.fn(() => 9999);
    const port = resolveServiceHostPort('tool-gateway', {
      env: { TOOL_GATEWAY_HOST_PORT: '3007' },
      discover,
      containerPort: 3000,
    });
    expect(port).toBe(3007);
    expect(discover).not.toHaveBeenCalled();
  });

  it('falls back to a docker probe when no env override is present', () => {
    const discover = jest.fn(() => 3006);
    const port = resolveServiceHostPort('tool-gateway', { env: {}, discover, containerPort: 3000 });
    expect(port).toBe(3006);
    expect(discover).toHaveBeenCalledWith('tool-gateway', 3000);
  });

  it('uses the supplied fallback when neither env nor docker yields a port', () => {
    const port = resolveServiceHostPort('tool-gateway', { env: {}, discover: () => undefined, fallback: 3001 });
    expect(port).toBe(3001);
  });

  it('defaults the fallback to 3001', () => {
    const port = resolveServiceHostPort('auth', { env: {}, discover: () => undefined });
    expect(port).toBe(3001);
  });
});

describe('fleet docker-ports — rewriteToLocalHostPort', () => {
  it('remaps an internal compose URL to localhost:<published host port>, preserving path', () => {
    const url = 'http://auth.bitbrat.local:3000/sse';
    const out = rewriteToLocalHostPort(url, 'auth', { env: { AUTH_HOST_PORT: '3006' } });
    expect(out).toBe('http://localhost:3006/sse');
  });

  it('uses the URL port as the container port hint for docker disambiguation', () => {
    const discover = jest.fn((_svc: string, containerPort?: number) => (containerPort === 8080 ? 4002 : 9999));
    const out = rewriteToLocalHostPort('http://story-engine-mcp.bitbrat.local:8080/sse', 'story-engine-mcp', {
      env: {},
      discover,
    });
    expect(out).toBe('http://localhost:4002/sse');
    expect(discover).toHaveBeenCalledWith('story-engine-mcp', 8080);
  });

  it('returns the input unchanged when it is not a parseable URL', () => {
    expect(rewriteToLocalHostPort('not a url', 'auth', { env: {} })).toBe('not a url');
  });
});
