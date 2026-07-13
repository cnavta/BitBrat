import inquirer from 'inquirer';
import type { AgentDetectionResult } from '../plugins/base-plugin';
import { AgentRegistry } from '../agent-registry';
import { getDetectedAgentsList } from '../discovery/detector';
import { getPreferredAgentId, setPreferredAgentId } from '../discovery/preference';

/**
 * Result of agent selection UI flow.
 */
export interface AgentSelectionResult {
  /** Selected agent ID */
  agentId: string;

  /** Whether selection was saved to user preferences */
  savedPreference: boolean;
}

/**
 * Interactive agent selection UI.
 *
 * Presents user with a list of detected coding agents and prompts them
 * to select one. Optionally saves the selection to user preferences.
 *
 * @param detected - Map of detected agents (from discoverAgents)
 * @param options - Selection options
 * @returns Promise resolving to selection result
 */
export async function selectAgent(
  detected: Map<string, AgentDetectionResult>,
  options: AgentSelectionOptions = {}
): Promise<AgentSelectionResult> {
  const { allowSavePreference = true, skipIfOnlyOne = true } = options;

  // If only one agent detected and skipIfOnlyOne is true, use it automatically
  if (skipIfOnlyOne && detected.size === 1) {
    const agentId = Array.from(detected.keys())[0];
    console.log(`Only one coding agent detected: ${getAgentName(agentId)}`);
    return { agentId, savedPreference: false };
  }

  // Build choices for inquirer
  const choices = await buildAgentChoices(detected);

  // Prompt user to select agent
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAgent',
      message: 'Select a coding agent:',
      choices,
      pageSize: 10,
    } as any,
  ]);
  const selectedAgent = answers.selectedAgent as string;

  // Ask if user wants to save preference
  let savedPreference = false;
  if (allowSavePreference) {
    const confirmAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'savePreference',
        message: 'Save this choice as your default agent?',
        default: false,
      } as any,
    ]);
    const savePreference = confirmAnswers.savePreference as boolean;

    if (savePreference) {
      try {
        await setPreferredAgentId(selectedAgent);
        savedPreference = true;
        console.log(`Saved ${getAgentName(selectedAgent)} as your default agent`);
      } catch (err) {
        console.warn(
          `Failed to save preference: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return { agentId: selectedAgent, savedPreference };
}

/**
 * Options for agent selection UI.
 */
export interface AgentSelectionOptions {
  /** Allow saving selection to preferences (default: true) */
  allowSavePreference?: boolean;

  /** Skip selection UI if only one agent detected (default: true) */
  skipIfOnlyOne?: boolean;
}

/**
 * Build inquirer choices from detected agents.
 *
 * @param detected - Map of detected agents
 * @returns Array of inquirer choice objects
 */
async function buildAgentChoices(
  detected: Map<string, AgentDetectionResult>
): Promise<Array<{ name: string; value: string; short: string }>> {
  const agentsList = await getDetectedAgentsList();

  return agentsList.map((agent) => {
    const versionSuffix = agent.version ? ` (v${agent.version})` : '';
    const description = agent.description ? ` - ${agent.description}` : '';

    return {
      name: `${agent.name}${versionSuffix}${description}`,
      value: agent.id,
      short: agent.name,
    };
  });
}

/**
 * Get human-readable agent name from ID.
 *
 * @param agentId - Plugin ID
 * @returns Agent name
 */
function getAgentName(agentId: string): string {
  const plugin = AgentRegistry.getPlugin(agentId);
  return plugin?.name || agentId;
}

/**
 * Select agent based on user preference, explicit flag, or interactive prompt.
 *
 * This is the main entry point for agent selection logic. It follows this priority:
 * 1. If --agent flag provided, use that (validate it's installed)
 * 2. If user has saved preference, use that (validate it's installed)
 * 3. Show interactive selection UI
 *
 * @param detected - Map of detected agents
 * @param explicitAgent - Agent ID from --agent flag (optional)
 * @returns Promise resolving to selection result
 * @throws Error if explicit agent not found or no agents detected
 */
export async function resolveAgent(
  detected: Map<string, AgentDetectionResult>,
  explicitAgent?: string
): Promise<AgentSelectionResult> {
  // No agents detected - error
  if (detected.size === 0) {
    throw new Error(
      'No coding agents detected. Please install one of: Claude Code, Aider, Continue, OpenHands'
    );
  }

  // Explicit agent via --agent flag
  if (explicitAgent) {
    if (!detected.has(explicitAgent)) {
      const availableAgents = Array.from(detected.keys()).join(', ');
      throw new Error(
        `Agent '${explicitAgent}' not found or not installed. Available agents: ${availableAgents}`
      );
    }

    console.log(`Using agent specified via --agent flag: ${getAgentName(explicitAgent)}`);
    return { agentId: explicitAgent, savedPreference: false };
  }

  // Check for saved preference
  const preferredAgent = await getPreferredAgentId();
  if (preferredAgent && detected.has(preferredAgent)) {
    console.log(
      `Using saved preference: ${getAgentName(preferredAgent)} (override with --agent flag)`
    );
    return { agentId: preferredAgent, savedPreference: false };
  }

  // No preference or preference no longer valid - show interactive selection
  if (preferredAgent && !detected.has(preferredAgent)) {
    console.warn(
      `Saved preference '${preferredAgent}' is not installed. Please select an agent:`
    );
  }

  return await selectAgent(detected);
}

/**
 * Display a summary of detected agents.
 *
 * Useful for debugging or informational output.
 *
 * @param detected - Map of detected agents
 */
export async function displayDetectedAgents(
  detected: Map<string, AgentDetectionResult>
): Promise<void> {
  console.log('\nDetected coding agents:');

  const agentsList = await getDetectedAgentsList();

  for (const agent of agentsList) {
    const versionSuffix = agent.version ? ` (v${agent.version})` : '';
    const description = agent.description ? ` - ${agent.description}` : '';
    console.log(`  - ${agent.name}${versionSuffix}${description}`);
  }

  console.log('');
}
