/**
 * SESSI (Stream Content Summarization & Inspection) Types
 */

export interface StreamSource {
  collection: 'events' | 'prompt_logs' | string;
  filters: Record<string, any>;
}

export interface StreamTrigger {
  type: 'cron' | 'on-demand' | 'hybrid';
  expression?: string; // cron expression for scheduled runs
  windowMs?: number;   // default window size in milliseconds
}

export interface StreamAnalysis {
  promptId: string;
  inspectionEnabled?: boolean;
  outputFormat?: 'markdown' | 'json' | string;
}

export interface StreamDelivery {
  egressTopic: string;
  destination?: {
    type: 'chat' | 'dm' | 'email' | string;
    target: string;
  };
}

export interface StreamObserver {
  id: string;
  active: boolean;
  mcpEnabled?: boolean; // Allow MCP tools to trigger this observer
  source: StreamSource;
  trigger: StreamTrigger;
  analysis: StreamAnalysis;
  delivery: StreamDelivery;
  updatedAt: string; // ISO8601
}

export interface SummarizationRequest {
  observerId?: string; // If targeting a specific observer
  streamType?: string; // e.g. "chat"
  windowMinutes?: number;
  filters?: Record<string, any>;
  inspectionEnabled?: boolean;
  requestId: string;
}
