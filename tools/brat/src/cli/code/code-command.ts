import { AgentRegistry } from './agent-registry';
import { ClaudeCodePlugin } from './plugins/claude-code-plugin';
import { AiderPlugin } from './plugins/aider-plugin';
import { ContinuePlugin } from './plugins/continue-plugin';
import { OpenHandsPlugin } from './plugins/openhands-plugin';
import { discoverAgents } from './discovery/detector';
import { resolveAgent, displayDetectedAgents } from './ui/selection';
import { extractProjectContext, findProjectRoot } from './context/project-context';
import { launchAgent, waitForAgentExit } from './launcher/agent-launcher';

/**
 * Register all available coding agent plugins.
 *
 * This is called once at module load time to populate the AgentRegistry
 * with all supported coding agents.
 */
function registerPlugins(): void {
  AgentRegistry.register(new ClaudeCodePlugin());
  AgentRegistry.register(new AiderPlugin());
  AgentRegistry.register(new ContinuePlugin());
  AgentRegistry.register(new OpenHandsPlugin());
}

/**
 * Parse key-value flags from command-line arguments.
 *
 * @param rest - Array of command-line arguments
 * @returns Object with parsed key-value pairs
 */
function parseKeyValueFlags(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    if (v !== undefined) out[key] = v;
    else out[key] = 'true';
  }
  return out;
}

/**
 * Main handler for the `brat code` command.
 *
 * Orchestrates the full flow:
 * 1. Discover installed coding agents
 * 2. Resolve which agent to use (flag, preference, or interactive)
 * 3. Extract project context
 * 4. Prepare agent configuration
 * 5. Launch agent
 * 6. Wait for agent to exit
 *
 * @param cmd - Command array
 * @param rest - Additional command-line arguments
 */
export async function cmdCode(cmd: string[], rest: string[]): Promise<void> {
  // Register plugins
  registerPlugins();

  // Parse flags
  const flags = parseKeyValueFlags(rest);
  const list = rest.includes('--list') || rest.includes('-l');
  const agent = flags['agent'] || flags['a'];
  const projectRoot = flags['project-root'] || flags['p'];

  try {
    // Discover installed agents
    const detected = await discoverAgents();

    // Handle --list flag
    if (list) {
      await displayDetectedAgents(detected);
      return;
    }

    // No agents detected
    if (detected.size === 0) {
      console.error('No coding agents detected on your system.');
      console.error('');
      console.error('Please install one of the following:');
      console.error('  - Claude Code: https://docs.claude.com/claude-code');
      console.error('  - Aider: https://aider.chat');
      console.error('  - Continue: https://continue.dev');
      console.error('  - OpenHands: https://www.all-hands.dev');
      process.exit(1);
    }

    // Resolve which agent to use
    const { agentId } = await resolveAgent(detected, agent);

    // Get the plugin
    const plugin = AgentRegistry.getPlugin(agentId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${agentId}`);
    }

    // Find project root
    const root = projectRoot || (await findProjectRoot()) || process.cwd();

    // Extract project context
    console.log('Loading project context...');
    const projectContext = await extractProjectContext(root);

    // Prepare agent configuration
    console.log(`Preparing ${plugin.name} configuration...`);
    const config = await plugin.prepareConfig(projectContext);

    // Collect pass-through arguments (anything that's not a known flag)
    const knownFlags = ['--list', '-l', '--agent', '-a', '--project-root', '-p'];
    const passThrough = rest.filter((arg, idx) => {
      // Remove known flags
      if (knownFlags.includes(arg)) return false;
      // Remove values after flags
      if (idx > 0 && knownFlags.includes(rest[idx - 1])) return false;
      // Remove key=value pairs with known keys
      if (arg.startsWith('--agent=') || arg.startsWith('--project-root=')) return false;
      return true;
    });

    // Launch agent
    console.log(`Launching ${plugin.name}...`);
    console.log('');
    const child = await launchAgent(config, passThrough);

    // Wait for agent to exit
    const exitCode = await waitForAgentExit(child);

    // Exit with same code as agent
    process.exit(exitCode || 0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
