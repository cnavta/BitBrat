#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadArchitecture(repoRoot) {
  const p = path.join(repoRoot, 'architecture.yaml');
  const src = fs.readFileSync(p, 'utf8');
  return yaml.load(src);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileSafe(filePath, content, force = false) {
  if (fs.existsSync(filePath) && !force) {
    return { skipped: true, path: filePath };
  }
  // Safety check: if file exists and we are forcing, check if it looks like a stub
  if (fs.existsSync(filePath) && force) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.includes('// TODO: implement domain behavior')) {
      // It's probably a stub, allow overwrite
    } else if (filePath.endsWith('.compose.yaml') || filePath.includes('Dockerfile.')) {
      // These are usually fine to overwrite as they are infra artifacts
    } else {
      console.warn(`[bootstrap-service] Safety skip: ${filePath} exists and does not look like a stub. Use manual edit.`);
      return { skipped: true, path: filePath, safetySkip: true };
    }
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return { skipped: false, path: filePath };
}

function toKebab(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function parseArgs(argv) {
  const args = { name: '', force: false, mcp: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') { args.name = argv[++i] || ''; }
    else if (a === '--force') { args.force = true; }
    else if (a === '--mcp') { args.mcp = true; }
    else if (a === '-h' || a === '--help') { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log('Usage: npm run bootstrap:service -- --name <service-name> [--force] [--mcp]');
  console.log('Reads architecture.yaml services.<name>.entry and generates:');
  console.log('- src/apps/<entry>.ts (Express stub with health endpoints and stubbed paths)');
  console.log('  - use --mcp to use McpServer instead of BaseServer');
  console.log('- src/apps/<entry>.test.ts (basic health tests)');
  console.log('- Dockerfile.<service> (Node 24, builds and runs the compiled entry)');
  console.log('- infrastructure/docker-compose/services/<service>.compose.yaml (local runtime)');
}

function toPascal(name) {
  const parts = String(name)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
  return parts.join('');
}

function generateAppSource(serviceName, stubPaths, consumedTopics = [], useMcp = false) {
  const SERVICE_NAME = serviceName;
  const ClassName = `${toPascal(serviceName)}Server`;
  const explicitHandlers = Array.isArray(stubPaths) && stubPaths.length > 0
    ? stubPaths.map((p) => {
        const route = p.replace(/\*/g, '{*path}');
        return `    app.get('${route}', (_req: Request, res: Response) => { res.status(200).end(); });`;
      }).join('\n')
    : '';
  const consumedList = Array.isArray(consumedTopics) ? consumedTopics : [];
  const consumedDecl = consumedList.length
    ? `const RAW_CONSUMED_TOPICS: string[] = ${JSON.stringify(consumedList, null, 2)};`
    : `const RAW_CONSUMED_TOPICS: string[] = [];`;
  const perTopicSubscriptions = consumedList.length
    ? consumedList.map((t) => `
      { // subscription for ${t}
        const raw = ${JSON.stringify(t)};
        const destination = raw && raw.includes('{instanceId}') ? raw.replace('{instanceId}', String(instanceId)) : raw;
        const queue = raw && raw.includes('{instanceId}') ? SERVICE_NAME + '.' + String(instanceId) : SERVICE_NAME;
        try {
          await this.onMessage<InternalEventV2>(
            { destination, queue, ack: 'explicit' },
            async (msg: InternalEventV2, _attributes, ctx) => {
              try {
                this.getLogger().info('${SERVICE_NAME}.message.received', {
                  destination,
                  type: (msg as any)?.type,
                  correlationId: (msg as any)?.correlationId,
                });
                // TODO: implement domain behavior for this topic
                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('${SERVICE_NAME}.message.handler_error', { destination, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('${SERVICE_NAME}.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('${SERVICE_NAME}.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }`).join('\n')
    : '';
  
  const baseClass = useMcp ? 'McpServer' : 'BaseServer';
  const baseImportPath = useMcp ? '../common/mcp-server' : '../common/base-server';
  const zodImport = useMcp ? "import { z } from 'zod';\n" : "";
  const mcpToolExample = useMcp ? `
    // Example MCP tool registration
    this.registerTool(
      'echo',
      'Echoes back the input',
      z.object({
        message: z.string().describe('The message to echo')
      }),
      async (args) => {
        return {
          content: [{ type: 'text', text: \`Echo: \${args.message}\` }]
        };
      }
    );
` : "";

  return `import { ${baseClass} } from '${baseImportPath}';
import { Express, Request, Response } from 'express';
${zodImport}import type { InternalEventV2 } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || '${SERVICE_NAME}';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

${consumedDecl}

class ${ClassName} extends ${baseClass} {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)
${explicitHandlers}
${mcpToolExample}
    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);
${perTopicSubscriptions}
    } catch (e: any) {
      this.getLogger().warn('${SERVICE_NAME}.subscribe.init_error', { error: e?.message || String(e) });
    }

    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();
  }
}

export function createApp() {
  const server = new ${ClassName}();
  return server.getApp();
}

if (require.main === module) {
  ${baseClass}.ensureRequiredEnv(SERVICE_NAME);
  const server = new ${ClassName}();
  void server.start(PORT);
}
`;
}

function generateTestSource(entryTsPath, stubPaths) {
  const rel = path.basename(entryTsPath);
  const paths = Array.isArray(stubPaths) ? stubPaths : [];
  const stubTests = paths.map((p) => {
    // Build a sample URL: replace :param with 123 and * with test; ensure trailing /* becomes /test
    let url = p.replace(/:([A-Za-z0-9_]+)/g, '123');
    url = url.replace(/\*/g, 'test');
    return `  it('stub ${p} -> 200', async () => {\n    await request(app).get('${url}').expect(200);\n  });`;
  }).join('\n');
  return `import request from 'supertest';
import { createApp } from './${rel.replace(/\.ts$/, '')}';

describe('generated service', () => {
  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });
${stubTests ? `
  describe('stubbed paths', () => {
${stubTests}
  });
` : ''}
});
`;
}

function generateDockerfile(serviceName, entryTsPath) {
  const entryJs = path.join('dist', entryTsPath.replace(/^src\//, '').replace(/\.ts$/, '.js'));
  return `# syntax=docker/dockerfile:1

FROM node:24-bullseye AS builder
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bullseye AS runner
WORKDIR /workspace
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
# Copy compiled app and architecture.yaml for runtime config lookups
COPY --from=builder /workspace/dist ./dist
COPY architecture.yaml ./architecture.yaml
EXPOSE 3000
ENV SERVICE_NAME=${serviceName}
ENV SERVICE_PORT=3000
CMD ["node", "${entryJs}"]
`;
}

function toUpperSnake(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function generateComposeSource(serviceName, image = null, env = [], secrets = []) {
  const upper = toUpperSnake(serviceName);
  const dockerfile = `Dockerfile.${toKebab(serviceName)}`;
  const kebab = toKebab(serviceName);
  
  const buildOrImage = image 
    ? `image: ${image}
    platform: linux/amd64`
    : `build:
      context: .
      dockerfile: ${dockerfile}`;

  const envList = [...(env || []), ...(secrets || [])];
  const environmentEntries = envList.map(e => `      - ${e}=\${${e}}`).join('\n');

  return `services:
  ${serviceName}:
    ${buildOrImage}
    env_file:
      - .env.local
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google-app-creds.json
${environmentEntries}
    volumes:
      - \${GOOGLE_APPLICATION_CREDENTIALS:?Set GOOGLE_APPLICATION_CREDENTIALS to a local JSON file}:/var/secrets/google-app-creds.json:ro
    ports:
      - "\${${upper}_HOST_PORT:-3001}:\${SERVICE_PORT:-3000}"
    depends_on:
      - nats
      - firebase-emulator
      - obs-mcp
      - auth
      - scheduler
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/healthz"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      bitbrat-network:
        aliases:
          - ${kebab}.bitbrat.local
`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.name) { printHelp(); process.exit(args.help ? 0 : 2); }
  const repoRoot = process.cwd();
  const arch = loadArchitecture(repoRoot);
  const serviceKey = args.name;
  const svc = arch.services && arch.services[serviceKey];
  if (!svc) {
    console.error(`[bootstrap-service] Service not found in architecture.yaml: ${serviceKey}`);
    process.exit(3);
  }
  const entry = svc.entry;
  const image = svc.image;

  if (!entry && !image) {
    console.error(`[bootstrap-service] Service ${serviceKey} has neither 'entry' nor 'image' in architecture.yaml`);
    process.exit(4);
  }

  const stubPaths = Array.isArray(svc.paths) ? svc.paths : [];
  const consumedTopics = (svc.topics && Array.isArray(svc.topics.consumes)) ? svc.topics.consumes : [];
  const envVars = Array.isArray(svc.env) ? svc.env : [];
  const secretVars = Array.isArray(svc.secrets) ? svc.secrets : [];

  const dockerfileName = `Dockerfile.${toKebab(serviceKey)}`;
  const dockerfilePath = path.join(repoRoot, dockerfileName);
  const composePath = path.join(repoRoot, 'infrastructure', 'docker-compose', 'services', `${toKebab(serviceKey)}.compose.yaml`);

  let appRes = { skipped: true, path: 'N/A' };
  let testRes = { skipped: true, path: 'N/A' };
  let dockRes = { skipped: true, path: 'N/A' };

  if (entry) {
    const appTsPath = path.join(repoRoot, entry);
    const testTsPath = appTsPath.replace(/\.ts$/, '.test.ts');
    appRes = writeFileSafe(appTsPath, generateAppSource(serviceKey, stubPaths, consumedTopics, args.mcp), args.force);
    testRes = writeFileSafe(testTsPath, generateTestSource(entry, stubPaths), args.force);
    dockRes = writeFileSafe(dockerfilePath, generateDockerfile(serviceKey, entry), args.force);
  }

  const composeRes = writeFileSafe(composePath, generateComposeSource(serviceKey, image, envVars, secretVars), args.force);

  console.log('[bootstrap-service] Results:');
  if (entry) {
    console.log(`- App: ${appRes.path} ${appRes.skipped ? '(exists, skipped)' : '(created)'}`);
    console.log(`- Test: ${testRes.path} ${testRes.skipped ? '(exists, skipped)' : '(created)'}`);
    console.log(`- Dockerfile: ${dockRes.path} ${dockRes.skipped ? '(exists, skipped)' : '(created)'}`);
  } else {
    console.log('- App: skipped (no entry)');
    console.log('- Test: skipped (no entry)');
    console.log('- Dockerfile: skipped (no entry)');
  }
  console.log(`- Compose: ${composeRes.path} ${composeRes.skipped ? '(exists, skipped)' : '(created)'}`);
  console.log('Next steps:');
  console.log(`- Build & test: npm run build && npm test`);
  console.log(`- Local (dry-run): npm run local -- --dry-run --service-name ${serviceKey}`);
  console.log(`- Local up: npm run local -- --service-name ${serviceKey}`);
  console.log(`- Local down: npm run local -- --down --service-name ${serviceKey}`);
  console.log(`- Dry-run cloud: npm run deploy:cloud -- --dry-run --service-name ${serviceKey}`);
  console.log(`- Apply cloud: npm run deploy:cloud -- --apply --service-name ${serviceKey}`);
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error('[bootstrap-service] Error:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

module.exports = { generateAppSource, generateTestSource, generateDockerfile, generateComposeSource, toKebab };
