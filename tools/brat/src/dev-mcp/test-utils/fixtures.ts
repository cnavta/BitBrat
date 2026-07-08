/**
 * Test fixtures for dev-mcp testing
 *
 * Provides sample data structures used in tests:
 * - Sample architecture.yaml content
 * - Mock registry data
 * - Sample tool responses
 */

/**
 * Sample architecture.yaml data (subset for testing)
 */
export const sampleArchitecture = {
  name: 'BitBrat Platform',
  version: '1.0.0',
  project: {
    name: 'BitBrat Platform',
    version: '1.0.0',
  },
  services: {
    'llm-bot': {
      active: true,
      category: 'platform',
      profile: 'llm',
      kind: 'pipeline-service',
      entry: 'src/apps/llm-bot-service.ts',
      port: 3000,
      mcp: {
        exposure: 'platform-only',
      },
      env: {
        LOG_LEVEL: 'info',
        MESSAGE_BUS_DRIVER: 'nats',
      },
      secrets: {
        OPENAI_API_KEY: 'openai-key',
      },
    },
    'event-router': {
      active: true,
      category: 'platform',
      profile: 'core',
      kind: 'pipeline-service',
      entry: 'src/apps/event-router-service.ts',
      port: 3001,
      mcp: {
        exposure: 'platform-only',
      },
      env: {
        LOG_LEVEL: 'debug',
      },
    },
  },
  messaging: {
    topics: [
      {
        name: 'internal.ingress.v1',
        retention: '7d',
        replicas: 3,
      },
      {
        name: 'internal.enriched.v1',
        retention: '7d',
        replicas: 3,
      },
    ],
  },
  infrastructure: {
    gcp: {
      projectId: 'bitbrat-platform',
      region: 'us-central1',
    },
  },
};

/**
 * Sample architecture.yaml as YAML string
 */
export const sampleArchitectureYaml = `name: BitBrat Platform
version: 1.0.0
project:
  name: BitBrat Platform
  version: 1.0.0
services:
  llm-bot:
    active: true
    category: platform
    profile: llm
    kind: pipeline-service
    entry: src/apps/llm-bot-service.ts
    port: 3000
    mcp:
      exposure: platform-only
    env:
      LOG_LEVEL: info
      MESSAGE_BUS_DRIVER: nats
    secrets: []
  event-router:
    active: true
    category: platform
    profile: core
    kind: pipeline-service
    entry: src/apps/event-router-service.ts
    port: 3001
    mcp:
      exposure: platform-only
    env:
      LOG_LEVEL: debug
messaging:
  topics:
    - name: internal.ingress.v1
      retention: 7d
      replicas: 3
    - name: internal.enriched.v1
      retention: 7d
      replicas: 3
infrastructure:
  gcp:
    projectId: bitbrat-platform
    region: us-central1
`;

/**
 * Sample registry data (Firestore documents)
 */
export const sampleRegistry = {
  bits: [
    {
      id: 'llm-bot',
      name: 'llm-bot',
      version: '1.0.0',
      category: 'platform',
      profile: 'llm',
      mcpUrl: 'http://llm-bot:3000/mcp',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'event-router',
      name: 'event-router',
      version: '1.0.0',
      category: 'platform',
      profile: 'core',
      mcpUrl: 'http://event-router:3001/mcp',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
  packs: [
    {
      id: 'twitch',
      name: 'twitch',
      description: 'Twitch integration pack',
      tools: ['twitch.send_message', 'twitch.get_channel_info'],
      createdAt: '2024-01-01T00:00:00Z',
    },
  ],
};

/**
 * Sample bit.info response
 */
export const sampleBitInfo = {
  name: 'llm-bot',
  version: '1.0.0',
  category: 'platform',
  profile: 'llm',
  uptime: 12345,
  pid: 1234,
  memory: {
    heapUsed: 50000000,
    heapTotal: 100000000,
    external: 5000000,
    rss: 120000000,
  },
  env: {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    MESSAGE_BUS_DRIVER: 'pubsub',
  },
};

/**
 * Sample bit.health response
 */
export const sampleBitHealth = {
  status: 'healthy',
  checks: {
    firestore: 'ok',
    messageBus: 'ok',
    memory: 'ok',
  },
  uptime: 12345,
  lastCheck: '2024-01-01T12:00:00Z',
};

/**
 * Sample bit.config.get response
 */
export const sampleBitConfig = {
  LOG_LEVEL: 'info',
  MESSAGE_BUS_DRIVER: 'pubsub',
  PORT: '3000',
  // Secrets are redacted
  OPENAI_API_KEY: '***REDACTED***',
};

/**
 * Sample audit log entries
 */
export const sampleAuditEntries = [
  {
    timestamp: '2024-01-01T12:00:00Z',
    tool: 'config.show',
    args: {},
    target: 'local',
    durationMs: 50,
    success: true,
  },
  {
    timestamp: '2024-01-01T12:01:00Z',
    tool: 'fleet.list',
    args: {},
    target: 'gcp-prod',
    durationMs: 120,
    success: true,
  },
  {
    timestamp: '2024-01-01T12:02:00Z',
    tool: 'persistence.read',
    args: {
      collection: 'commands',
      id: 'cmd-123',
    },
    target: 'local',
    durationMs: 80,
    success: true,
  },
];

/**
 * Sample MCP tool call request
 */
export const sampleToolCallRequest = {
  method: 'tools/call',
  params: {
    name: 'config.show',
    arguments: {},
  },
};

/**
 * Sample MCP tool call response
 */
export const sampleToolCallResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify(sampleArchitecture, null, 2),
    },
  ],
};

/**
 * Sample Firestore collection data
 */
export const sampleFirestoreCollections = {
  commands: [
    {
      id: 'cmd-1',
      name: 'greet',
      pattern: 'hello|hi|hey',
      action: 'respond',
      response: 'Hello there!',
    },
    {
      id: 'cmd-2',
      name: 'help',
      pattern: 'help|commands',
      action: 'list_commands',
    },
  ],
  packs: [
    {
      id: 'pack-1',
      name: 'twitch',
      description: 'Twitch integration',
      tools: ['twitch.send', 'twitch.channel_info'],
    },
  ],
  'bitbrat-registry': [
    {
      id: 'llm-bot',
      name: 'llm-bot',
      version: '1.0.0',
      mcpUrl: 'http://llm-bot:3000/mcp',
      status: 'active',
    },
  ],
};
