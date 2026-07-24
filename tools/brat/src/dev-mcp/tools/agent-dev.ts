/**
 * Sprint 358: Agent-Dev MCP Tools
 *
 * Lifecycle management tools for agent-dev execution contexts.
 * Enables agents to provision, manage, and destroy their own dedicated BECs.
 */

import { z } from 'zod';
import { ToolDefinition } from '../types.js';
import { AgentDevContextManager } from '../agent-dev-context-manager.js';
import * as path from 'path';

/**
 * Find repository root by walking up directory tree
 */
function findRootDir(): string {
  let current = process.cwd();

  while (true) {
    const archPath = path.join(current, 'architecture.yaml');
    const fs = require('fs');
    if (fs.existsSync(archPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Could not find repository root (architecture.yaml not found)');
    }

    current = parent;
  }
}

/**
 * Get shared AgentDevContextManager instance
 */
let sharedManager: AgentDevContextManager | undefined;
function getManager(): AgentDevContextManager {
  if (!sharedManager) {
    const repoRoot = findRootDir();
    sharedManager = new AgentDevContextManager(repoRoot);
  }
  return sharedManager;
}

/**
 * agent_dev.provision - Provision new agent-dev execution context
 *
 * Creates a new ephemeral execution context for agent development.
 * Returns connection details (gateway URL, PostgreSQL, etc.).
 */
export const agentDevProvisionTool: ToolDefinition = {
  name: 'agent_dev.provision',
  description: 'Provision a new agent-dev execution context with all required infrastructure',
  inputSchema: z.object({
    name: z.string().optional().describe('Custom context name (must start with agent-dev-). Auto-generated if omitted.'),
    profile: z.enum(['dev', 'staging']).optional().describe('Deployment profile (default: dev)'),
    persistence: z.enum(['postgres', 'firestore']).optional().describe('Persistence driver (default: postgres)'),
  }),
  handler: async (args) => {
    try {
      const manager = getManager();

      // Provision context
      const result = await manager.provision({
        name: args.name,
        profile: args.profile,
        persistence: args.persistence || 'postgres',
      });

      // Format response
      const response = {
        success: true,
        message: `✅ Context provisioned successfully`,
        context: {
          name: result.name,
          status: result.status,
        },
        gateway: {
          url: result.gateway.url,
          authToken: result.gateway.authToken ? '<redacted>' : undefined,
        },
        postgres: {
          host: result.postgres.host,
          port: result.postgres.port,
          database: result.postgres.database,
        },
        nextSteps: [
          `▶️  Start services: agent_dev.start({ name: "${result.name}" })`,
          `📊 Monitor logs: fleet.logs({ context: "${result.name}" })`,
          `💾 Query database: db.query({ collection: "..." })`,
        ],
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Enhanced error messages with remediation
      let errorMessage = `❌ Error provisioning context: ${error.message}`;

      if (error.message.includes('already exists')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Use a different name: agent_dev.provision({ name: "agent-dev-my-context" })\n';
        errorMessage += '  - Or destroy the existing context first: agent_dev.destroy({ name: "...", confirm: true })';
      } else if (error.message.includes('agent-dev-')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Context names must start with "agent-dev-"\n';
        errorMessage += '  - Example: agent_dev.provision({ name: "agent-dev-my-context" })';
      } else if (error.message.includes('Docker') || error.message.includes('docker')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Ensure Docker is running: docker info\n';
        errorMessage += '  - Check Docker disk space: docker system df';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * agent_dev.start - Start agent-dev execution context
 *
 * Launches all services in the agent-dev context via DockerOrchestrator.
 * Waits for PostgreSQL and NATS readiness, seeds database.
 */
export const agentDevStartTool: ToolDefinition = {
  name: 'agent_dev.start',
  description: 'Start all services in an agent-dev execution context and wait for readiness',
  inputSchema: z.object({
    name: z.string().describe('Context name to start (must start with agent-dev-)'),
    service: z.string().optional().describe('Optional: start only this specific service'),
  }),
  handler: async (args) => {
    try {
      const manager = getManager();

      // Start context
      const result = await manager.start(args.name, args.service);

      // Format response
      const response = {
        success: true,
        message: `✅ Services started successfully`,
        context: args.name,
        status: result.status,
        gateway: {
          url: result.gateway.url,
        },
        services: result.services,
        nextSteps: [
          `📊 View logs: fleet.logs({ context: "${args.name}" })`,
          `🔍 Check status: fleet.info({ context: "${args.name}" })`,
          `🔌 Connect to gateway: ${result.gateway.url}`,
        ],
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Enhanced error messages with remediation
      let errorMessage = `❌ Error starting context: ${error.message}`;

      if (error.message.includes('not found')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += `  - Provision context first: agent_dev.provision({ name: "${args.name}" })\n`;
        errorMessage += '  - Or list available contexts: fleet.list()';
      } else if (error.message.includes('PostgreSQL')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Check PostgreSQL container: docker ps | grep postgres\n';
        errorMessage += `  - View logs: fleet.logs({ context: "${args.name}", bit: "postgres" })\n`;
        errorMessage += '  - Verify connection: psql -h localhost -U bitbrat -d bitbrat';
      } else if (error.message.includes('NATS')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Check NATS container: docker ps | grep nats\n';
        errorMessage += `  - View logs: fleet.logs({ context: "${args.name}", bit: "nats" })`;
      } else if (error.message.includes('Docker') || error.message.includes('docker')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Ensure Docker is running: docker info\n';
        errorMessage += '  - Check for port conflicts: docker ps -a\n';
        errorMessage += '  - View compose logs: docker compose -p bitbrat-' + args.name + ' logs';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * agent_dev.stop - Stop agent-dev execution context
 *
 * Gracefully stops all services while preserving data for restart.
 * Volumes and database are NOT removed (use destroy for full cleanup).
 */
export const agentDevStopTool: ToolDefinition = {
  name: 'agent_dev.stop',
  description: 'Stop all services in an agent-dev execution context (preserves data for restart)',
  inputSchema: z.object({
    name: z.string().describe('Context name to stop (must start with agent-dev-)'),
  }),
  handler: async (args) => {
    try {
      const manager = getManager();

      // Stop context
      await manager.stop(args.name);

      // Format response
      const response = {
        success: true,
        message: `✅ Services stopped successfully. Data preserved for restart.`,
        context: args.name,
        status: 'stopped',
        nextSteps: [
          `▶️  Restart: agent_dev.start({ name: "${args.name}" })`,
          `🗑️  Destroy: agent_dev.destroy({ name: "${args.name}", confirm: true })`,
        ],
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Enhanced error messages with remediation
      let errorMessage = `❌ Error stopping context: ${error.message}`;

      if (error.message.includes('not found')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Context may already be stopped or destroyed\n';
        errorMessage += '  - List available contexts: fleet.list()';
      } else if (error.message.includes('Docker') || error.message.includes('docker')) {
        errorMessage += '\n\n💡 Remediation:\n';
        errorMessage += '  - Ensure Docker is running: docker info\n';
        errorMessage += '  - Force remove containers: docker compose -p bitbrat-' + args.name + ' down';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * agent_dev.destroy - Destroy agent-dev execution context
 *
 * Complete cleanup of all resources:
 * - Docker containers and volumes
 * - PostgreSQL database
 * - Environment directory
 * - Ephemeral context entry
 *
 * This operation is IRREVERSIBLE. All data will be lost.
 */
export const agentDevDestroyTool: ToolDefinition = {
  name: 'agent_dev.destroy',
  description: 'Completely destroy an agent-dev execution context and all associated resources (IRREVERSIBLE)',
  inputSchema: z.object({
    name: z.string().describe('Context name to destroy (must start with agent-dev-)'),
    confirm: z.boolean().optional().describe('Confirmation flag (must be true)'),
  }),
  handler: async (args) => {
    // Require confirmation
    if (args.confirm !== true) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `ERROR: Destroy operation requires explicit confirmation.\n\nTo destroy context '${args.name}', call:\nagent_dev.destroy({ name: "${args.name}", confirm: true })\n\nWARNING: This will permanently delete all data, containers, volumes, and configuration.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const manager = getManager();

      // Destroy context
      await manager.destroy(args.name);

      // Format response
      const response = {
        success: true,
        message: `✅ Context destroyed successfully. All resources removed.`,
        context: args.name,
        status: 'destroyed',
        removedResources: [
          '🐳 Docker containers and volumes',
          '💾 PostgreSQL database',
          '📁 Environment directory',
          '📋 Ephemeral context entry',
        ],
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Parse partial failure messages
      const isPartialFailure = error.message.includes('Destroy completed with');

      let errorMessage: string;
      if (isPartialFailure) {
        errorMessage = `⚠️ Partial cleanup: ${error.message}\n\n`;
        errorMessage += '💡 Remediation:\n';
        errorMessage += `  - Safe to retry: agent_dev.destroy({ name: "${args.name}", confirm: true })\n`;
        errorMessage += '  - Operation is idempotent (can run multiple times)\n';
        errorMessage += '  - Check remaining resources: docker ps -a | grep ' + args.name;
      } else {
        errorMessage = `❌ Error destroying context: ${error.message}`;

        if (error.message.includes('non-agent context')) {
          errorMessage += '\n\n💡 Remediation:\n';
          errorMessage += '  - agent_dev tools can only manage contexts starting with "agent-dev-"\n';
          errorMessage += '  - Use brat context commands for other contexts';
        } else if (error.message.includes('Docker') || error.message.includes('docker')) {
          errorMessage += '\n\n💡 Remediation:\n';
          errorMessage += '  - Ensure Docker is running: docker info\n';
          errorMessage += `  - Manual cleanup: docker compose -p bitbrat-${args.name} down -v\n`;
          errorMessage += `  - Remove env directory: rm -rf env/${args.name}`;
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: errorMessage,
          },
        ],
        isError: !isPartialFailure,
      };
    }
  },
};

/**
 * All agent-dev tools
 */
export const agentDevTools: ToolDefinition[] = [
  agentDevProvisionTool,
  agentDevStartTool,
  agentDevStopTool,
  agentDevDestroyTool,
];
