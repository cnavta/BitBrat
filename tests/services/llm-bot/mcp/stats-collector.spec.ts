import { McpStatsCollector } from '../../../../src/common/mcp/stats-collector';

describe('McpStatsCollector', () => {
  let collector: McpStatsCollector;

  beforeEach(() => {
    collector = new McpStatsCollector();
  });

  it('should initialize with empty stats', () => {
    expect(collector.getAllServerStats()).toEqual({});
    expect(collector.getAllToolStats()).toEqual({});
  });

  it('should update server status', () => {
    collector.updateServerStatus('test-server', 'connected', 'stdio');
    const stats = collector.getServerStats('test-server');
    expect(stats?.status).toBe('connected');
    expect(stats?.transport).toBe('stdio');
    expect(stats?.connectedAt).toBeDefined();
  });

  it('should record discovery', () => {
    collector.recordDiscovery('test-server', 5, 100);
    const stats = collector.getServerStats('test-server');
    expect(stats?.discoveryCount).toBe(5);
    expect(stats?.discoveryTimeMs).toBe(100);
  });

  it('should record calls and update stats', () => {
    collector.updateServerStatus('test-server', 'connected');
    
    // Success call
    collector.recordCall('test-server', 'mcp:tool1', 50, false, 100);
    
    let sStats = collector.getServerStats('test-server');
    let tStats = collector.getToolStats('mcp:tool1');
    
    expect(sStats?.totalInvocations).toBe(1);
    expect(sStats?.totalErrors).toBe(0);
    expect(sStats?.avgLatencyMs).toBe(50);
    
    expect(tStats?.invocations).toBe(1);
    expect(tStats?.errors).toBe(0);
    expect(tStats?.avgLatencyMs).toBe(50);
    expect(tStats?.lastResponseSize).toBe(100);
    expect(tStats?.minLatencyMs).toBe(50);
    expect(tStats?.maxLatencyMs).toBe(50);

    // Error call
    collector.recordCall('test-server', 'mcp:tool1', 150, true, 0);
    
    sStats = collector.getServerStats('test-server');
    tStats = collector.getToolStats('mcp:tool1');
    
    expect(sStats?.totalInvocations).toBe(2);
    expect(sStats?.totalErrors).toBe(1);
    expect(sStats?.avgLatencyMs).toBe(100); // (50 + 150) / 2
    
    expect(tStats?.invocations).toBe(2);
    expect(tStats?.errors).toBe(1);
    expect(tStats?.avgLatencyMs).toBe(100);
    expect(tStats?.minLatencyMs).toBe(50);
    expect(tStats?.maxLatencyMs).toBe(150);
  });

  it('should calculate uptime', () => {
    const past = new Date(Date.now() - 65000).toISOString(); // 65 seconds ago
    collector.updateServerStatus('test-server', 'connected');
    const stats = collector.getServerStats('test-server');
    if (stats) stats.connectedAt = past;
    
    collector.recordCall('test-server', 'mcp:tool1', 10, false);
    
    const updatedStats = collector.getServerStats('test-server');
    expect(updatedStats?.uptime).toContain('1m 5s');
  });
});
