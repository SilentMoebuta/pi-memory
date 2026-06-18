export type MemoryType = 'fact' | 'decision' | 'preference' | 'procedure' | 'correction';
export type MemorySource = 'agent' | 'user' | 'consolidated';
export type MemoryStatus = 'active' | 'archived' | 'superseded' | 'deleted';

export interface MemoryInput {
  type: MemoryType;
  content: string;
  project?: string;
  sessionId?: string;
  confidence?: number;
  source?: MemorySource;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  accessCount: number;
  lastAccess: number | null;
  createdAt: number;
  sessionId: string | null;
  project: string;
  source: MemorySource;
  status: MemoryStatus;
  supersededBy: string | null;
}

export interface SearchOptions {
  type?: MemoryType;
  project?: string;
  limit?: number;
  status?: MemoryStatus;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface RecallResult {
  l2Results: SearchResult[];
  l3Results: SearchResult[];
  combined: SearchResult[];
}

export interface MemoryStats {
  total: number;
  // Type/status keys are only present when at least one memory of that
  // kind exists (GROUP BY), so these are partial maps at runtime.
  byType: Partial<Record<MemoryType, number>>;
  byStatus: Partial<Record<MemoryStatus, number>>;
  byProject: Record<string, number>;
  lastConsolidation: number | null;
  avgConfidence: number;
}

export interface ConsolidationResult {
  decayed: number;
  archived: number;
  merged: number;
  promoted: number;
  reindexed: boolean;
}
