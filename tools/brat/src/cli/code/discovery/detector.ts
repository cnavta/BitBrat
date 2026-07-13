import { AgentRegistry } from '../agent-registry';
import type { AgentDetectionResult } from '../plugins/base-plugin';

/**
 * Discover installed coding agents on the system.
 *
 * Scans all registered plugins and calls their detect() methods to identify
 * which coding agents are installed. Detection failures are non-fatal and
 * logged at debug level.
 *
 * @returns Map of plugin ID to detection result (only includes detected agents)
 */
export async function discoverAgents(): Promise<Map<string, AgentDetectionResult>> {
  const plugins = AgentRegistry.getAllPlugins();
  const results = new Map<string, AgentDetectionResult>();

  for (const plugin of plugins) {
    try {
      const detection = await plugin.detect();

      if (detection.installed) {
        results.set(plugin.id, detection);
      }
    } catch (err) {
      // Detection failures are non-fatal - log and continue
      console.debug(`Failed to detect ${plugin.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

/**
 * Detect a specific agent by ID.
 *
 * Useful when the user specifies an agent explicitly via --agent flag.
 *
 * @param agentId - Plugin ID to detect
 * @returns Detection result or null if plugin not found
 * @throws Error if detection fails
 */
export async function detectAgent(agentId: string): Promise<AgentDetectionResult | null> {
  const plugin = AgentRegistry.getPlugin(agentId);

  if (!plugin) {
    return null;
  }

  return await plugin.detect();
}

/**
 * Check if any coding agents are installed.
 *
 * Quick check to determine if we have at least one coding agent available.
 *
 * @returns True if at least one agent is detected
 */
export async function hasAnyAgents(): Promise<boolean> {
  const detected = await discoverAgents();
  return detected.size > 0;
}

/**
 * Get a list of detected agent IDs.
 *
 * @returns Array of plugin IDs for detected agents
 */
export async function getDetectedAgentIds(): Promise<string[]> {
  const detected = await discoverAgents();
  return Array.from(detected.keys());
}

/**
 * Get a formatted list of detected agents for display.
 *
 * @returns Array of formatted strings (e.g., "Claude Code (v1.2.3)")
 */
export async function getDetectedAgentsList(): Promise<Array<{ id: string; name: string; version?: string; description?: string }>> {
  const detected = await discoverAgents();
  const list: Array<{ id: string; name: string; version?: string; description?: string }> = [];

  for (const [id, result] of detected.entries()) {
    const plugin = AgentRegistry.getPlugin(id);
    if (plugin) {
      list.push({
        id: plugin.id,
        name: plugin.name,
        version: result.version,
        description: getAgentDescription(plugin.id),
      });
    }
  }

  return list;
}

/**
 * Get a human-readable description for a coding agent.
 *
 * @param agentId - Plugin ID
 * @returns Description string
 */
function getAgentDescription(agentId: string): string {
  const descriptions: Record<string, string> = {
    'claude-code': "Anthropic's official CLI coding agent",
    'aider': 'AI pair programming in your terminal',
    'continue': 'Open-source autopilot for software development',
    'openhands': 'Autonomous coding agent with web browsing',
  };

  return descriptions[agentId] || 'Coding agent';
}
