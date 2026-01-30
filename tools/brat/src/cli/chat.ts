import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';

interface ChatOptions {
  env: string;
  projectId: string;
  url?: string;
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

export async function cmdChat(flags: any) {
  const env = flags.env || process.env.BITBRAT_ENV || 'local';
  const projectId = flags.projectId || process.env.PROJECT_ID || 'twitch-452523';
  const url = flags.url;

  const controller = new ChatController({ env, projectId, url });
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
    console.log(`\n--- BitBrat Chat CLI (${this.options.env}) ---`);
    
    try {
      if (process.env.NODE_ENV !== 'test') {
        this.name = await this.promptForName();
      }

      this.token = this.resolveToken();
      if (!this.token) {
        console.error(`${COLORS.red}Error: No API token found. Please set BITBRAT_API_TOKEN or create a .bitbrat.json file.${COLORS.reset}`);
        process.exit(1);
      }

      const url = this.resolveUrl();
      console.log(`Connecting to ${url}...`);

      this.ws = new WS(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      this.setupWebSocket();
      if (process.env.NODE_ENV !== 'test') {
        this.setupTerminal();
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

  private resolveUrl(): string {
    let url = '';
    if (this.options.url) {
      url = this.options.url;
    } else {
      const { env } = this.options;
      if (env === 'local') {
        const port = process.env.API_GATEWAY_HOST_PORT || '3001';
        url = `ws://localhost:${port}/ws/v1`;
      } else if (env === 'prod') {
        url = 'wss://api.bitbrat.ai/ws/v1';
      } else {
        url = `wss://api.${env}.bitbrat.ai/ws/v1`;
      }
    }

    if (this.name) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}userId=brat-chat:${encodeURIComponent(this.name)}`;
    }
    return url;
  }

  private setupWebSocket() {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log('Connected to BitBrat Platform.');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.rl?.prompt();
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
    if (frame.type === 'connection.ready') {
      console.log(`${COLORS.gray}Session ready. User ID: ${frame.payload.user_id}${COLORS.reset}`);
    } else if (frame.type === 'chat.message.received') {
      const source = frame.metadata?.source || frame.payload?.source || 'platform';
      const text = frame.payload?.text || '';
      const isUser = source === 'api-gateway';
      const color = isUser ? COLORS.cyan : COLORS.green;
      const label = isUser ? 'You' : source;
      process.stdout.write(`\r${color}[${label}]${COLORS.reset} ${text}\n`);
    } else if (frame.type === 'chat.error') {
      process.stdout.write(`\r${COLORS.red}[Platform Error] ${frame.payload.message}${COLORS.reset}\n`);
    } else {
      // Generic output for other types
      process.stdout.write(`\r${COLORS.yellow}[${frame.type}]${COLORS.reset} ${JSON.stringify(frame.payload)}\n`);
    }
    this.rl?.prompt();
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
