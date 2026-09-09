/**
 * SESSI (Stream Content Summarization & Inspection) Types
 * v4: Real-time event stream processing with in-memory sliding windows
 */

// Legacy v3 types (database polling)
export interface StreamSource {
  collection: 'events' | 'prompt_logs' | string;
  filters: Record<string, any>;
}

export interface StreamTrigger {
  type: 'cron' | 'on-demand' | 'hybrid';
  expression?: string; // cron expression for scheduled runs
  windowMs?: number;   // default window size in milliseconds
}

// v4: New streaming types
export interface StreamSourceV4 {
  mode: 'stream' | 'database' | 'hybrid';

  // Stream mode configuration
  topics?: string[];  // e.g., ["internal.contextualization.v1"]
  filters?: {
    platforms?: string[];  // e.g., ["twitch", "discord"]
    eventTypes?: string[];  // e.g., ["chat.message.v1"]
    channels?: string[];   // e.g., ["#bitbrat"]
    customLogic?: any;     // JsonLogic for advanced filtering
  };

  // Database mode configuration (fallback to v3)
  collection?: 'events' | 'prompt_logs' | string;
  dbFilters?: Record<string, any>;
}

export interface StreamWindowConfig {
  type: 'sliding' | 'tumbling' | 'session';
  sizeMs: number;              // e.g., 300000 (5 minutes)
  slideMs?: number;            // For sliding windows (e.g., 60000 = 1 min)
  sessionGapMs?: number;       // For session windows
  maxEvents?: number;          // Memory safety (evict oldest if exceeded)
  lateEventToleranceMs?: number;  // Accept events up to N ms late
}

export interface StreamTriggerV4 {
  type: 'time' | 'count' | 'condition';

  // Time-based: Analyze when window closes
  timeConfig?: {
    windowCloseStrategy?: 'on-time' | 'on-event-after-time';
  };

  // Count-based: Analyze after N events
  countConfig?: {
    threshold: number;  // e.g., 100 events
  };

  // Condition-based: Analyze when pattern detected
  conditionConfig?: {
    logic: any;  // JsonLogic expression
  };
}

export interface StreamAnalysis {
  promptId: string;
  inspectionEnabled?: boolean;
  outputFormat?: 'markdown' | 'json' | string;
  throttleMs?: number;  // Min time between analyses
}

export interface StreamDelivery {
  egressTopic: string;
  destination?: {
    type: 'chat' | 'dm' | 'email' | string;
    target: string;
  };
}

// v4: Updated StreamObserver with streaming support
export interface StreamObserver {
  id: string;
  active: boolean;
  mcpEnabled?: boolean; // Allow MCP tools to trigger this observer

  // v4: New streaming properties
  source?: StreamSourceV4;
  window?: StreamWindowConfig;
  trigger?: StreamTriggerV4;

  analysis: StreamAnalysis;
  delivery: StreamDelivery;
  createdAt?: string; // ISO8601
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
