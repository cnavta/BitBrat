import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { loadArchitecture } from '../config/loader.js';

interface ChatOptions {
  env: string;
  projectId: string;
  url?: string;
  message?: string; // One-shot message for non-interactive mode
  user?: string;    // Username for non-interactive mode
}

const WS = WebSocket;

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m'
};

function parseFlagMap(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    out[key] = v !== undefined ? v : 'true';
  }
  return out;
}

export async function cmdChat(flags: any, rest: string[] = []) {
  // Parse additional flags from rest array first
  const restFlags = parseFlagMap(rest);

  // Support both --env and --target for environment selection (--target for consistency with docker commands)
  const env = flags.env || restFlags.target || restFlags.env || process.env.BITBRAT_ENV || 'local';
  const projectId = flags.projectId || process.env.PROJECT_ID || 'twitch-452523';
  const url = flags.url || restFlags.url;

  const message = restFlags.message || restFlags.m; // Support --message or -m
  const user = restFlags.user || restFlags.u;       // Support --user or -u

  const controller = new ChatController({ env, projectId, url, message, user });
  await controller.start();
}

class ChatController {
  private ws: any = null;
  private rl: readline.Interface | null = null;
  private token: string | null = null;
  private name: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY_MS = 2000;

  constructor(private options: ChatOptions) {}

  public async start() {
    const isOneShotMode = !!this.options.message;

    if (!isOneShotMode) {
      console.log(`\n--- BitBrat Chat CLI (${this.options.env}) ---`);
    }

    try {
      // In one-shot mode, use provided user or default to "cli-user"
      if (isOneShotMode) {
        this.name = this.options.user || 'cli-user';
      } else if (process.env.NODE_ENV !== 'test') {
        this.name = await this.promptForName();
      }

      this.token = this.resolveToken();
      if (!this.token) {
        console.error(`${COLORS.red}Error: No API token found. Please set BITBRAT_API_TOKEN or create a .bitbrat.json file.${COLORS.reset}`);
        process.exit(1);
      }

      const url = this.resolveUrl();
      if (!isOneShotMode) {
        console.log(`Connecting to ${url}...`);
      } else if (process.env.DEBUG) {
        console.error(`[DEBUG] Connecting to ${url}`);
      }

      this.ws = new WS(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      this.setupWebSocket();

      // Only setup interactive terminal if not in one-shot mode
      if (!isOneShotMode && process.env.NODE_ENV !== 'test') {
        this.setupTerminal();
      }

      // Add timeout for one-shot mode
      if (isOneShotMode) {
        setTimeout(() => {
          if (this.ws && this.ws.readyState !== 3) { // 3 = CLOSED
            console.error('Timeout waiting for response');
            process.exit(1);
          }
        }, 10000); // 10 second timeout
      }
    } catch (err: any) {
      console.error(`${COLORS.red}Initialization error: ${err.message}${COLORS.reset}`);
      process.exit(1);
    }
  }

  private async promptForName(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('Enter your name: ', (answer) => {
        rl.close();
        resolve(answer.trim() || 'anonymous');
      });
    });
  }

  private resolveToken(): string | null {
    if (process.env.BITBRAT_API_TOKEN) {
      return process.env.BITBRAT_API_TOKEN;
    }

    const configPath = path.join(process.cwd(), '.bitbrat.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.apiToken || config.token || null;
      } catch (err) {
        console.warn(`Warning: Failed to parse ${configPath}`);
      }
    }

    return null;
  }

  private findRootDir(): string {
    let currentDir = process.cwd();
    const maxDepth = 10;
    let depth = 0;

    while (depth < maxDepth) {
      const archPath = path.join(currentDir, 'architecture.yaml');
      if (fs.existsSync(archPath)) {
        return currentDir;
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        // Reached filesystem root
        break;
      }
      currentDir = parent;
      depth++;
    }

    // Default to current directory if not found
    return process.cwd();
  }

  private resolveUrl(): string {
    let url = '';
    if (this.options.url) {
      url = this.options.url;
    } else {
      const { env } = this.options;

      // Try to load gateway URL from architecture.yaml for non-local environments
      if (env !== 'local') {
        try {
          const rootDir = this.findRootDir();
          const arch = loadArchitecture(rootDir);
          const deploymentTarget = arch?.deploymentTargets?.[env];

          if (deploymentTarget?.gateway?.url) {
            // Convert HTTP/HTTPS to WS/WSS
            const gatewayUrl = deploymentTarget.gateway.url
              .replace(/^https/, 'wss')
              .replace(/^http/, 'ws');

            url = `${gatewayUrl}/ws/v1`;

            // Debug output in one-shot mode
            if (this.options.message && process.env.DEBUG) {
              console.error(`[DEBUG] Resolved gateway URL from architecture.yaml: ${url}`);
            }
          }
        } catch (err) {
          // Fall through to hardcoded defaults if architecture.yaml can't be loaded
          if (process.env.DEBUG) {
            console.error(`[DEBUG] Failed to load gateway URL from architecture.yaml: ${err}`);
          }
        }
      }

      // Fallback logic if no gateway URL found in architecture.yaml
      if (!url) {
        if (env === 'local') {
          const discoveredPort = this.discoverLocalPort();
          const port = process.env.API_GATEWAY_HOST_PORT || discoveredPort || '3004';
          url = `ws://localhost:${port}/ws/v1`;

          // Debug output in one-shot mode
          if (this.options.message && !discoveredPort && !process.env.API_GATEWAY_HOST_PORT) {
            console.error(`[DEBUG] Port discovery failed, using default port ${port}`);
          }
        } else if (env === 'prod') {
          url = 'wss://api.bitbrat.ai/ws/v1';
        } else {
          // Generic fallback for unknown environments
          url = `wss://api.${env}.bitbrat.ai/ws/v1`;
        }
      }
    }

    if (this.name) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}userId=brat-chat:${encodeURIComponent(this.name)}`;
    }
    return url;
  }

  private discoverLocalPort(): string | null {
    try {
      // Use more specific filters: look for a container belonging to this project (via labels)
      // or specifically named with api-gateway.
      const cmd = 'docker ps --filter "label=com.docker.compose.service=api-gateway" --filter "status=running" --format "{{.Ports}}"';
      const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

      // Look for something like 0.0.0.0:3004->3000/tcp or [::]:3004->3000/tcp
      // Fixed regex to work on macOS (BSD grep doesn't support -P flag)
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        // Match port mapping: 0.0.0.0:PORT->3000/tcp or [::]:PORT->3000/tcp
        const match = line.match(/:(\d+)->3000\/tcp/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (err) {
      // Docker might not be running or command failed, fall back to default
    }
    return null;
  }

  private setupWebSocket() {
    if (!this.ws) return;
    const isOneShotMode = !!this.options.message;

    this.ws.on('open', () => {
      if (!isOneShotMode) {
        console.log('Connected to BitBrat Platform.');
      } else if (process.env.DEBUG) {
        console.error('[DEBUG] WebSocket connected');
      }
      this.reconnectAttempts = 0;
      this.startHeartbeat();

      // In one-shot mode, send message immediately
      if (isOneShotMode && this.options.message) {
        if (process.env.DEBUG) {
          console.error(`[DEBUG] Sending message: ${this.options.message}`);
        }
        this.sendMessage(this.options.message);
      } else {
        this.rl?.prompt();
      }
    });

    this.ws.on('message', (data: any) => {
      try {
        const frame = JSON.parse(data.toString());
        this.handleIncomingFrame(frame);
      } catch (err) {
        console.error('\n[Error parsing incoming message]');
      }
    });

    this.ws.on('close', (code: number, reason: string) => {
      this.stopHeartbeat();
      if (code !== 1000 && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnect();
      } else {
        console.log(`\nDisconnected from platform (code: ${code}, reason: ${reason || 'none'})`);
        process.exit(0);
      }
    });

    this.ws.on('error', (err: any) => {
      console.error(`\nWebSocket Error: ${err.message}`);
      if (this.options.message) {
        // In one-shot mode, exit on error
        process.exit(1);
      }
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) { // 1 is OPEN
        this.ws.send(JSON.stringify({ type: 'heartbeat', payload: {}, metadata: { id: uuidv4() } }));
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private reconnect() {
    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY_MS * this.reconnectAttempts;
    console.log(`\nConnection lost. Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`);
    
    setTimeout(async () => {
      try {
        const url = this.resolveUrl();
        this.ws = new WS(url, {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });
        this.setupWebSocket();
      } catch (err: any) {
        console.error(`Reconnect failed: ${err.message}`);
      }
    }, delay);
  }

  private setupTerminal() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'brat> '
    });

    this.rl.on('line', (line) => {
      const input = line.trim();
      if (!input) {
        this.rl?.prompt();
        return;
      }

      if (input.startsWith('/')) {
        this.handleCommand(input);
        return;
      }

      this.sendMessage(input);
    });

    this.rl.on('close', () => {
      console.log('\nExiting chat...');
      if (this.ws && typeof this.ws.close === 'function') {
        this.ws.close();
      }
      process.exit(0);
    });
  }

  private handleIncomingFrame(frame: any) {
    const isOneShotMode = !!this.options.message;

    if (frame.type === 'connection.ready') {
      if (!isOneShotMode) {
        console.log(`${COLORS.gray}Session ready. User ID: ${frame.payload.user_id}${COLORS.reset}`);
      }
    } else if (frame.type === 'chat.message.received') {
      const source = frame.metadata?.source || frame.payload?.source || 'platform';
      const text = frame.payload?.text || '';
      // User echoes have source='api-gateway', bot responses have source from candidate (e.g., 'llm-bot')
      const isUser = source === 'api-gateway';

      if (isOneShotMode) {
        // In one-shot mode, only output bot responses (not user echoes)
        if (!isUser) {
          console.log(text);
          // Exit after receiving first bot response
          this.ws?.close(1000, 'one-shot complete');
          process.exit(0);
        }
      } else {
        const color = isUser ? COLORS.cyan : COLORS.green;
        const label = isUser ? 'You' : source;
        process.stdout.write(`\r${color}[${label}]${COLORS.reset} ${text}\n`);
      }
    } else if (frame.type === 'chat.error') {
      if (isOneShotMode) {
        console.error(frame.payload.message);
        process.exit(1);
      } else {
        process.stdout.write(`\r${COLORS.red}[Platform Error] ${frame.payload.message}${COLORS.reset}\n`);
      }
    } else if (!isOneShotMode) {
      // Generic output for other types (only in interactive mode)
      process.stdout.write(`\r${COLORS.yellow}[${frame.type}]${COLORS.reset} ${JSON.stringify(frame.payload)}\n`);
    }

    if (!isOneShotMode) {
      this.rl?.prompt();
    }
  }

  private handleCommand(input: string) {
    const [cmd, ...args] = input.split(' ');
    switch (cmd.toLowerCase()) {
      case '/exit':
      case '/quit':
        this.rl?.close();
        break;
      case '/help':
        console.log('Available commands:');
        console.log('  /exit, /quit - Terminate the session');
        console.log('  /help       - Show this help message');
        console.log('  /clear      - Clear the terminal screen');
        break;
      case '/clear':
        console.log('\x1Bc');
        break;
      default:
        console.log(`Unknown command: ${cmd}. Type /help for available commands.`);
        break;
    }
    this.rl?.prompt();
  }

  private sendMessage(text: string) {
    if (!this.ws || this.ws.readyState !== 1) { // 1 is OPEN
      console.error('Error: Not connected to platform.');
      this.rl?.prompt();
      return;
    }

    const frame = {
      type: 'chat.message.send',
      payload: {
        text
      },
      metadata: {
        id: uuidv4()
      }
    };

    this.ws.send(JSON.stringify(frame));
    this.rl?.prompt();
  }
}
