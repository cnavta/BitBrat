export interface McpServerConfig {
  name: string;
  transport?: 'stdio' | 'sse' | 'inactive';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  requiredRoles?: string[];
  toolPrefix?: string;
  agentAllowlist?: string[];
  status?: 'active' | 'inactive';
}

export interface SessionContext {
  userId?: string;
  roles: string[];
  agentName?: string;
  tenantId?: string;
}
