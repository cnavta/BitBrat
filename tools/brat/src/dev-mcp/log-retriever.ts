/**
 * Log Retriever
 *
 * Multi-target log retrieval supporting Cloud Run (Google Cloud Logging) and Docker (docker compose logs).
 * Determines deployment type per Bit and routes to appropriate retrieval strategy.
 */

import {
  TargetConnection,
  LogRequest,
  LogResponse,
  LogEntry,
  DeploymentType,
  LogLevel
} from './types.js';
import { FirestoreRegistryReader } from '../fleet/firestore-registry.js';
import { Logging } from '@google-cloud/logging';
import { execSync } from 'child_process';
import {
  parseDockerLogs,
  parseTimeDuration,
  filterByLevel,
  filterByCorrelation
} from './log-parser.js';
import { LokiClient } from './loki-client.js';

/**
 * LogRetriever class
 *
 * Orchestrates log retrieval across different deployment targets.
 */
export class LogRetriever {
  private connection: TargetConnection;
  private registry: FirestoreRegistryReader;
  private lokiClient?: LokiClient;
  private lokiAvailable: boolean = false;
  private lokiChecked: boolean = false;

  constructor(connection: TargetConnection) {
    this.connection = connection;

    // Use Firestore for registry
    this.registry = new FirestoreRegistryReader({
      projectId: connection.firestore.projectId,
      databaseId: connection.firestore.databaseId
    });

    // Initialize Loki client with remote URL for remote-ssh targets
    if (connection.type === 'local') {
      // Local: use localhost
      this.lokiClient = new LokiClient({
        url: 'http://localhost:3100',
        timeout: 5000
      });
    } else if (connection.type === 'remote-ssh' && connection.ssh) {
      // Remote SSH: use SSH tunnel or remote Loki URL
      // For now, disable Loki for remote targets (fall back to Docker logs via SSH)
      // TODO: Support SSH tunneling to remote Loki (requires port forwarding)
      this.lokiClient = undefined;
    }
  }

  /**
   * Check if Loki is available for log queries
   *
   * Caches the result to avoid repeated health checks.
   */
  private async checkLokiAvailability(): Promise<boolean> {
    if (this.lokiChecked) {
      return this.lokiAvailable;
    }

    if (!this.lokiClient) {
      this.lokiChecked = true;
      this.lokiAvailable = false;
      return false;
    }

    try {
      this.lokiAvailable = await this.lokiClient.isAvailable();
      this.lokiChecked = true;
      return this.lokiAvailable;
    } catch (error) {
      this.lokiChecked = true;
      this.lokiAvailable = false;
      return false;
    }
  }

  /**
   * Query logs across all services for a given correlation ID
   *
   * This is optimized for distributed tracing - when Loki is available,
   * it uses a single query without service filtering to get logs from
   * all Bits in one request.
   *
   * @param correlationId - Correlation ID to trace
   * @param limit - Maximum number of logs to return (default: 5000)
   * @returns Array of log entries from all services
   */
  async getTraceLogsByCorrelationId(correlationId: string, limit: number = 5000): Promise<LogEntry[]> {
    // Check if Loki is available
    const lokiAvailable = await this.checkLokiAvailability();

    if (lokiAvailable && this.lokiClient) {
      try {
        // Use Loki to query across all services in a single request
        const logs = await this.lokiClient.query({
          correlationId,
          limit
        });
        return logs;
      } catch (error: any) {
        // Loki query failed - caller will need to fall back to per-Bit queries
        if (process.env.LOG_LEVEL === 'debug') {
          console.error(`[LogRetriever] Loki trace query failed: ${error.message}`);
        }
        throw error; // Throw to signal caller to use fallback
      }
    }

    // Loki not available - caller should use per-Bit queries
    throw new Error('Loki not available - use per-Bit queries for tracing');
  }

  /**
   * Main entry point: retrieve logs based on request parameters
   */
  async getLogs(request: LogRequest): Promise<LogResponse> {
    try {
      // Validate request
      if (!request.bit) {
        throw new Error('Bit name is required');
      }

      // Resolve deployment type for the Bit
      const deploymentType = await this.resolveBitDeployment(request.bit);

      // Route to appropriate log retriever based on deployment type
      let logs: LogEntry[];
      if (deploymentType === 'cloud-run') {
        logs = await this.getCloudRunLogs(request);
      } else {
        logs = await this.getDockerLogs(request);
      }

      // Return response
      return {
        bit: request.bit,
        target: this.connection.name,
        count: logs.length,
        logs,
        deploymentType
      };
    } catch (error: any) {
      // Return error response
      return {
        bit: request.bit,
        target: this.connection.name,
        count: 0,
        logs: [],
        error: error.message || String(error)
      };
    }
  }

  /**
   * Resolve deployment type for a Bit by querying registry and parsing URL
   */
  async resolveBitDeployment(bitName: string): Promise<DeploymentType> {
    // Query mcp_servers registry to get Bit URL
    const servers = await this.registry.listServers();
    const server = servers.find(s => s.name === bitName);

    if (!server) {
      throw new Error(`Bit '${bitName}' not found in mcp_servers registry`);
    }

    if (!server.url) {
      throw new Error(`Bit '${bitName}' has no URL registered`);
    }

    const url = server.url.toLowerCase();

    // Detect Cloud Run: https://*.run.app or https://*.a.run.app
    if (url.includes('.run.app')) {
      return 'cloud-run';
    }

    // Detect Docker: http://localhost:* or http://*.bitbrat.local:*
    if (url.includes('localhost') || url.includes('.bitbrat.local')) {
      return 'docker';
    }

    // Unknown deployment type
    throw new Error(
      `Unable to determine deployment type for Bit '${bitName}' with URL: ${server.url}. ` +
      `Expected Cloud Run (*.run.app) or Docker (localhost/* or *.bitbrat.local/*)`
    );
  }

  /**
   * Retrieve logs from Cloud Run using Google Cloud Logging API
   */
  private async getCloudRunLogs(request: LogRequest): Promise<LogEntry[]> {
    if (!request.bit) {
      throw new Error('Bit name is required for log retrieval');
    }

    if (!this.connection.firestore) {
      throw new Error('Cloud Run logs require Firestore connection (not available for PostgreSQL targets)');
    }

    // Initialize Cloud Logging client
    const logging = new Logging({
      projectId: this.connection.firestore.projectId
    });

    // Build Cloud Logging filter
    const filters: string[] = [
      `resource.type="cloud_run_revision"`,
      `resource.labels.service_name="${request.bit}"`
    ];

    // Add severity filtering if levels specified
    if (request.level && request.level.length > 0) {
      const minSeverity = this.mapLevelToSeverity(request.level);
      filters.push(`severity>=${minSeverity}`);
    }

    // Add time range filtering
    if (request.since) {
      const sinceTimestamp = parseTimeDuration(request.since);
      filters.push(`timestamp>="${sinceTimestamp}"`);
    }

    if (request.until) {
      filters.push(`timestamp<="${request.until}"`);
    }

    // Add correlation ID filtering
    if (request.correlationId) {
      filters.push(`jsonPayload.correlationId="${request.correlationId}"`);
    }

    const filter = filters.join(' AND ');

    // Execute query
    const [entries] = await logging.getEntries({
      filter,
      orderBy: 'timestamp desc',
      pageSize: request.limit || 100
    });

    // Transform Cloud Logging entries to LogEntry format
    return entries.map((entry: any) => {
      const payload = entry.data || {};
      return {
        timestamp: entry.metadata?.timestamp || new Date().toISOString(),
        level: this.severityToLevel(entry.metadata?.severity),
        service: request.bit,
        message: payload.message || payload.msg || entry.textPayload || '',
        correlationId: payload.correlationId,
        ...payload
      };
    });
  }

  /**
   * Retrieve logs from Docker using Loki (if available) or docker compose logs (fallback)
   */
  private async getDockerLogs(request: LogRequest): Promise<LogEntry[]> {
    if (!request.bit) {
      throw new Error('Bit name is required for log retrieval');
    }

    // Check if Loki is available and try to use it first
    const lokiAvailable = await this.checkLokiAvailability();

    if (lokiAvailable && this.lokiClient) {
      try {
        // Try Loki first
        const logs = await this.lokiClient.query(request);
        return logs;
      } catch (error: any) {
        // Loki query failed, fall back to Docker logs
        // Note: We silently fall back to ensure graceful degradation
        // Only log at debug level to avoid noise
        if (process.env.LOG_LEVEL === 'debug') {
          console.error(`[LogRetriever] Loki query failed, falling back to Docker logs: ${error.message}`);
        }
      }
    }

    // Fallback to Docker compose logs
    return this.getDockerComposeLogs(request);
  }

  /**
   * Retrieve logs directly from Docker using docker compose logs
   *
   * This is the fallback when Loki is unavailable or fails.
   */
  private async getDockerComposeLogs(request: LogRequest): Promise<LogEntry[]> {
    if (!request.bit) {
      throw new Error('Bit name is required for log retrieval');
    }

    // Build docker compose logs command
    const args: string[] = ['compose', 'logs', '--no-color'];

    // Add tail limit
    // When filtering by correlation ID, use a much larger tail to ensure we capture the event
    // Default to 2000 lines for Docker (each event generates ~58 log lines, so 2000 ≈ 34 events)
    const tailLimit = request.correlationId ? 5000 : (request.limit || 2000);
    args.push('--tail', tailLimit.toString());

    // Add time range filters
    if (request.since) {
      // Docker accepts duration or timestamp
      args.push('--since', request.since);
    }

    if (request.until) {
      args.push('--until', request.until);
    }

    // Add service name (Bit name with underscores replaced by hyphens)
    const serviceName = request.bit.replace(/_/g, '-');
    args.push(serviceName);

    // Execute docker compose logs (local or remote)
    try {
      let output: string;

      if (this.connection.type === 'remote-ssh' && this.connection.ssh) {
        // Remote SSH execution
        output = this.executeRemoteDockerCommand(args);
      } else {
        // Local execution
        output = execSync(`docker ${args.join(' ')}`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          stdio: ['pipe', 'pipe', 'pipe']
        });
      }

      // Parse docker compose log output
      let logs = parseDockerLogs(output, request.bit);

      // Apply client-side filters
      if (request.level && request.level.length > 0) {
        logs = filterByLevel(logs, request.level);
      }

      if (request.correlationId) {
        logs = filterByCorrelation(logs, request.correlationId);
      }

      return logs;
    } catch (error: any) {
      // If service not found or other docker error, return empty array
      if (error.message?.includes('no such service') || error.message?.includes('No such service')) {
        return [];
      }
      throw new Error(`Failed to retrieve Docker logs: ${error.message}`);
    }
  }

  /**
   * Execute a docker command on a remote host via SSH
   *
   * For remote hosts, we use `docker logs` directly on container names
   * since docker compose may not have configuration files accessible.
   */
  private executeRemoteDockerCommand(dockerArgs: string[]): string {
    if (!this.connection.ssh) {
      throw new Error('SSH connection details not available');
    }

    const { target } = this.connection.ssh;

    // Extract service name from docker compose logs command
    // dockerArgs is like: ['compose', 'logs', '--no-color', '--tail', '50', '--since', '1h', 'llm-bot']
    const serviceName = dockerArgs[dockerArgs.length - 1];

    // For remote SSH, use docker logs directly on container (skip docker compose)
    // This avoids issues with missing compose files on remote hosts
    try {
      // Find the container name for this service
      const findContainerCmd = `ssh ${target} "docker ps --filter 'name=${serviceName}' --format '{{.Names}}' | head -1"`;

      const containerName = execSync(findContainerCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (!containerName) {
        // No running container - return empty string (expected for stopped services)
        if (process.env.LOG_LEVEL === 'debug') {
          console.error(`[LogRetriever] No running container found for service '${serviceName}'`);
        }
        return '';
      }

      // Build docker logs command with same options (adapted for docker logs vs compose logs)
      const logsArgs: string[] = ['logs'];

      // Map compose log options to docker logs options
      // Note: docker logs doesn't support --no-color (it's a docker compose logs option)
      for (let i = 0; i < dockerArgs.length; i++) {
        const arg = dockerArgs[i];

        // Skip 'compose' and 'logs' from original command
        if (arg === 'compose' || (arg === 'logs' && i === 1)) {
          continue;
        }

        // Skip --no-color (docker logs doesn't support it, docker compose logs does)
        if (arg === '--no-color') {
          continue;
        }

        // Copy over compatible options (--tail, --since, --until, etc.)
        if (arg.startsWith('--') || arg.startsWith('-')) {
          logsArgs.push(arg);
          // If this option takes a value, include the next arg
          if (['--tail', '--since', '--until'].includes(arg) && i + 1 < dockerArgs.length) {
            logsArgs.push(dockerArgs[++i]);
          }
        }
      }

      // Add container name
      logsArgs.push(containerName);

      // Execute docker logs command
      const dockerLogsCmd = `ssh ${target} "docker ${logsArgs.join(' ')}"`;

      return execSync(dockerLogsCmd, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error: any) {
      throw new Error(`Failed to retrieve Docker logs via SSH: ${error.message}`);
    }
  }

  /**
   * Map log level to Cloud Logging severity
   * Returns minimum severity for filtering
   */
  private mapLevelToSeverity(levels: LogLevel[]): string {
    // Map to Cloud Logging severity levels
    const severityMap: Record<LogLevel, string> = {
      'trace': 'DEBUG',
      'debug': 'DEBUG',
      'info': 'INFO',
      'warn': 'WARNING',
      'error': 'ERROR'
    };

    // Find minimum severity from provided levels
    const severityOrder = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
    let minSeverity = 'DEBUG';

    for (const level of levels) {
      const severity = severityMap[level];
      if (severityOrder.indexOf(severity) > severityOrder.indexOf(minSeverity)) {
        minSeverity = severity;
      }
    }

    return minSeverity;
  }

  /**
   * Convert Cloud Logging severity to BitBrat log level
   */
  private severityToLevel(severity?: string): LogLevel {
    if (!severity) return 'info';

    const upper = severity.toUpperCase();
    if (upper === 'ERROR' || upper === 'CRITICAL' || upper === 'ALERT' || upper === 'EMERGENCY') {
      return 'error';
    }
    if (upper === 'WARNING') return 'warn';
    if (upper === 'INFO' || upper === 'NOTICE') return 'info';
    if (upper === 'DEBUG') return 'debug';

    return 'info'; // Default
  }
}
