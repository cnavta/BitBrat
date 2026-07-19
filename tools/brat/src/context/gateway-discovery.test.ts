/**
 * Sprint 349: Gateway Discovery Unit Tests
 */

import { execSync } from 'child_process';
import { discoverGatewayPort, extractHostFromSSH } from './gateway-discovery';

// Mock child_process
jest.mock('child_process');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('Gateway Discovery - Sprint 349', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverGatewayPort', () => {
    it('discovers port from local docker ps output', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3004->3000/tcp\n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBe('3004');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("docker ps --filter 'label=com.docker.compose.service=api-gateway'"),
        expect.any(Object)
      );
    });

    it('discovers port from remote docker ps output (SSH)', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3002->3000/tcp\n' as any);

      const port = await discoverGatewayPort('ssh://root@bitbrat.lan');

      expect(port).toBe('3002');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('ssh root@bitbrat.lan'),
        expect.any(Object)
      );
    });

    it('handles IPv6 format ([::]:PORT->)', async () => {
      mockExecSync.mockReturnValue('[::]:3004->3000/tcp\n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBe('3004');
    });

    it('handles multiple port mappings (returns first)', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3004->3000/tcp, 0.0.0.0:3005->3001/tcp\n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBe('3004');
    });

    it('returns null when no container found (empty output)', async () => {
      mockExecSync.mockReturnValue('' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBeNull();
    });

    it('returns null when docker command fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Docker not running');
      });

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBeNull();
    });

    it('returns null when SSH connection fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('SSH connection refused');
      });

      const port = await discoverGatewayPort('ssh://root@unreachable.host');

      expect(port).toBeNull();
    });

    it('returns null when output has no port mapping', async () => {
      mockExecSync.mockReturnValue('no ports exposed\n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBeNull();
    });

    it('uses correct docker ps command for local host', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3004->3000/tcp\n' as any);

      await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(mockExecSync).toHaveBeenCalledWith(
        "docker ps --filter 'label=com.docker.compose.service=api-gateway' --format '{{.Ports}}'",
        expect.any(Object)
      );
    });

    it('uses correct SSH command for remote host', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3002->3000/tcp\n' as any);

      await discoverGatewayPort('ssh://root@bitbrat.lan');

      expect(mockExecSync).toHaveBeenCalledWith(
        'ssh root@bitbrat.lan "docker ps --filter \'label=com.docker.compose.service=api-gateway\' --format \'{{.Ports}}\'"',
        expect.any(Object)
      );
    });

    it('respects timeout (10 seconds)', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3004->3000/tcp\n' as any);

      await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 10000 })
      );
    });
  });

  describe('extractHostFromSSH', () => {
    it('extracts host from ssh://user@host', () => {
      const host = extractHostFromSSH('ssh://root@bitbrat.lan');
      expect(host).toBe('bitbrat.lan');
    });

    it('extracts host from ssh://user@host:port', () => {
      const host = extractHostFromSSH('ssh://user@example.com:2222');
      expect(host).toBe('example.com');
    });

    it('extracts host from ssh://host (no user)', () => {
      const host = extractHostFromSSH('ssh://bitbrat.lan');
      expect(host).toBe('bitbrat.lan');
    });

    it('returns localhost for invalid SSH URL', () => {
      const host = extractHostFromSSH('invalid-url');
      expect(host).toBe('localhost');
    });

    it('handles SSH URLs with paths', () => {
      const host = extractHostFromSSH('ssh://user@bitbrat.lan/some/path');
      expect(host).toBe('bitbrat.lan');
    });
  });

  describe('edge cases', () => {
    it('handles whitespace in docker ps output', async () => {
      mockExecSync.mockReturnValue('  0.0.0.0:3004->3000/tcp  \n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBe('3004');
    });

    it('handles different port formats', async () => {
      const testCases = [
        { output: '0.0.0.0:8080->3000/tcp', expected: '8080' },
        { output: '0.0.0.0:80->3000/tcp', expected: '80' },
        { output: '0.0.0.0:443->3000/tcp', expected: '443' },
        { output: '[::]:9000->3000/tcp', expected: '9000' },
      ];

      for (const { output, expected } of testCases) {
        mockExecSync.mockReturnValue(output as any);
        const port = await discoverGatewayPort('unix:///var/run/docker.sock');
        expect(port).toBe(expected);
      }
    });

    it('handles multiline output (takes first line)', async () => {
      mockExecSync.mockReturnValue('0.0.0.0:3004->3000/tcp\n0.0.0.0:3005->3000/tcp\n' as any);

      const port = await discoverGatewayPort('unix:///var/run/docker.sock');

      expect(port).toBe('3004');
    });
  });
});
