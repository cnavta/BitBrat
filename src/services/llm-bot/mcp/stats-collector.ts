export interface ToolStats {
  invocations: number;
  errors: number;
  avgLatencyMs: number;
  lastUsed?: string;
  lastResponseSize?: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
}

export interface ServerStats {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  transport?: string;
  connectedAt?: string;
  uptime?: string;
  totalInvocations: number;
  totalErrors: number;
  avgLatencyMs: number;
  lastUsed?: string;
  discoveryCount: number;
  discoveryTimeMs: number;
  tools: string[];
}

export class McpStatsCollector {
  private serverStats: Map<string, ServerStats> = new Map();
  private toolStats: Map<string, ToolStats> = new Map();

  getServerStats(serverName: string): ServerStats | undefined {
    return this.serverStats.get(serverName);
  }

  getToolStats(toolId: string): ToolStats | undefined {
    return this.toolStats.get(toolId);
  }

  getAllServerStats(): Record<string, ServerStats> {
    return Object.fromEntries(this.serverStats);
  }

  getAllToolStats(): Record<string, ToolStats> {
    return Object.fromEntries(this.toolStats);
  }

  updateServerStatus(serverName: string, status: ServerStats['status'], transport?: string) {
    const current = this.serverStats.get(serverName) || this.createDefaultServerStats();
    current.status = status;
    if (transport) current.transport = transport;
    if (status === 'connected') {
      current.connectedAt = new Date().toISOString();
    }
    this.serverStats.set(serverName, current);
  }

  recordDiscovery(serverName: string, toolCount: number, durationMs: number) {
    const current = this.serverStats.get(serverName) || this.createDefaultServerStats();
    current.discoveryCount = toolCount;
    current.discoveryTimeMs = durationMs;
    this.serverStats.set(serverName, current);
  }

  updateServerTools(serverName: string, tools: string[]) {
    const current = this.serverStats.get(serverName) || this.createDefaultServerStats();
    current.tools = tools;
    this.serverStats.set(serverName, current);
  }

  recordCall(serverName: string, toolId: string, durationMs: number, error: boolean, responseSize?: number) {
    const now = new Date().toISOString();

    // Update Tool Stats
    const tStats = this.toolStats.get(toolId) || this.createDefaultToolStats();
    tStats.invocations++;
    if (error) tStats.errors++;
    tStats.totalLatencyMs += durationMs;
    tStats.avgLatencyMs = Math.round(tStats.totalLatencyMs / tStats.invocations);
    tStats.minLatencyMs = Math.min(tStats.minLatencyMs, durationMs);
    tStats.maxLatencyMs = Math.max(tStats.maxLatencyMs, durationMs);
    tStats.lastUsed = now;
    if (responseSize !== undefined) tStats.lastResponseSize = responseSize;
    this.toolStats.set(toolId, tStats);

    // Update Server Stats
    const sStats = this.serverStats.get(serverName) || this.createDefaultServerStats();
    sStats.totalInvocations++;
    if (error) sStats.totalErrors++;
    // We could track total server latency too, but architecture showed it as avg.
    // Let's keep it simple and just update based on invocations.
    // Re-calculating avg server latency is a bit tricky if we don't store total latency at server level.
    // Let's add totalLatencyMs to ServerStats too for accuracy.
    (sStats as any).totalLatencyMs = ((sStats as any).totalLatencyMs || 0) + durationMs;
    sStats.avgLatencyMs = Math.round((sStats as any).totalLatencyMs / sStats.totalInvocations);
    sStats.lastUsed = now;
    
    // Update uptime if connected
    if (sStats.connectedAt) {
      sStats.uptime = this.calculateUptime(sStats.connectedAt);
    }

    this.serverStats.set(serverName, sStats);
  }

  private createDefaultServerStats(): ServerStats {
    return {
      status: 'disconnected',
      totalInvocations: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
      discoveryCount: 0,
      discoveryTimeMs: 0,
      tools: []
    };
  }

  private createDefaultToolStats(): ToolStats {
    return {
      invocations: 0,
      errors: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: -Infinity
    };
  }

  private calculateUptime(connectedAt: string): string {
    const start = new Date(connectedAt).getTime();
    const now = new Date().getTime();
    const diff = now - start;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
