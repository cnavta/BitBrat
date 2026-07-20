import { cmdChat } from '../chat';
import EventEmitter from 'events';
import * as fs from 'fs';

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  return undefined as never;
});

// Mock console
const mockLog = jest.spyOn(console, 'log').mockImplementation();
const mockError = jest.spyOn(console, 'error').mockImplementation();

// Mock fs to prevent ContextResolver from finding architecture.yaml (tests use legacy behavior)
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

class SimpleMockWS extends EventEmitter {
  readyState = 0; // CONNECTING
  send = jest.fn();
  close = jest.fn();
  headers: any;

  constructor(url: string, options: any) {
    super();
    this.headers = options.headers;
    SimpleMockWS.instance = this;
    setImmediate(() => {
      this.readyState = 1; // OPEN
      this.emit('open');
    });
  }
  static instance: SimpleMockWS | null = null;
}

// We need to mock the require of 'ws' inside chat.ts or use the WS export we added
jest.mock('ws', () => {
  return {
    default: jest.fn().mockImplementation((url, opts) => new SimpleMockWS(url, opts)),
    __esModule: true
  };
});

describe('Chat CLI Protocol Simple', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BITBRAT_API_TOKEN = 'test-token';
    SimpleMockWS.instance = null;
    // Mock fs.existsSync to return false so ContextResolver can't find architecture.yaml
    // This forces fallback to legacy discovery logic (which these tests validate)
    mockFs.existsSync.mockReturnValue(false);
    // Mock fs.readFileSync to throw when ContextResolver tries to read architecture.yaml
    (mockFs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
  });

  it('should send authentication and handle connection.ready', (done) => {
    cmdChat({ env: 'local' });

    const check = setInterval(() => {
      const ws = SimpleMockWS.instance;
      if (ws) {
        clearInterval(check);
        expect(ws.headers['Authorization']).toBe('Bearer test-token');
        
        ws.emit('message', JSON.stringify({
          type: 'connection.ready',
          payload: { user_id: 'test-user' }
        }));

        setTimeout(() => {
          const logs = mockLog.mock.calls.map(c => c[0]);
          expect(logs).toContainEqual(expect.stringContaining('Connected to BitBrat Platform'));
          expect(logs).toContainEqual(expect.stringContaining('Session ready. User ID: test-user'));
          done();
        }, 100);
      }
    }, 50);
  });

  it('should use the provided --url flag if present', (done) => {
    const customUrl = 'ws://example.com/custom';
    cmdChat({ env: 'local', url: customUrl });

    const check = setInterval(() => {
      const ws = SimpleMockWS.instance;
      if (ws) {
        clearInterval(check);
        const WS = require('ws').default;
        expect(WS).toHaveBeenCalledWith(customUrl, expect.any(Object));
        done();
      }
    }, 50);
  });

  it('should respect API_GATEWAY_HOST_PORT environment variable for local env', (done) => {
    process.env.API_GATEWAY_HOST_PORT = '4000';
    cmdChat({ env: 'local' });

    const check = setInterval(() => {
      const ws = SimpleMockWS.instance;
      if (ws) {
        clearInterval(check);
        const WS = require('ws').default;
        expect(WS).toHaveBeenCalledWith(expect.stringContaining('localhost:4000'), expect.any(Object));
        delete process.env.API_GATEWAY_HOST_PORT;
        done();
      }
    }, 50);
  });

  it('should dynamically discover port from docker if API_GATEWAY_HOST_PORT is missing', (done) => {
    const { execSync } = require('child_process');
    const mockExecSync = execSync as jest.Mock;
    // Return string (not Buffer) because discoverLocalPort() uses encoding: 'utf8'
    mockExecSync.mockReturnValue('0.0.0.0:3006->3000/tcp');

    cmdChat({ env: 'local' });

    const check = setInterval(() => {
      const ws = SimpleMockWS.instance;
      if (ws) {
        clearInterval(check);
        const WS = require('ws').default;
        expect(WS).toHaveBeenCalledWith(expect.stringContaining('localhost:3006'), expect.any(Object));
        done();
      }
    }, 50);
  });
});
