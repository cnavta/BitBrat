export interface McpServerConfig {
  name: string;
  transport?: 'stdio' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  requiredRoles?: string[];
  toolPrefix?: string;
  agentAllowlist?: string[];
  status?: 'active' | 'inactive';
}
