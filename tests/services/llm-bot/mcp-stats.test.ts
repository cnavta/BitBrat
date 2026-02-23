import { McpStatsCollector } from '../../../src/common/mcp/stats-collector';

describe('McpStatsCollector', () => {
  let collector: McpStatsCollector;

  beforeEach(() => {
    collector = new McpStatsCollector();
  });

  test('records calls and calculates error rate', () => {
    collector.recordCall('server1', 'mcp:tool1', 100, false);
    collector.recordCall('server1', 'mcp:tool1', 200, true);

    const tStats = collector.getToolStats('mcp:tool1');
    expect(tStats?.invocations).toBe(2);
    expect(tStats?.errors).toBe(1);
    expect(tStats?.errorRate).toBe(0.5);
    expect(tStats?.avgLatencyMs).toBe(150);

    const sStats = collector.getServerStats('server1');
    expect(sStats?.totalInvocations).toBe(2);
    expect(sStats?.totalErrors).toBe(1);
    expect(sStats?.errorRate).toBe(0.5);
    expect(sStats?.avgLatencyMs).toBe(150);
  });

  test('tracks min/max latency', () => {
    collector.recordCall('server1', 'mcp:tool1', 100, false);
    collector.recordCall('server1', 'mcp:tool1', 50, false);
    collector.recordCall('server1', 'mcp:tool1', 150, false);

    const tStats = collector.getToolStats('mcp:tool1');
    expect(tStats?.minLatencyMs).toBe(50);
    expect(tStats?.maxLatencyMs).toBe(150);
    expect(tStats?.avgLatencyMs).toBe(100);
  });
});
