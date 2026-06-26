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
  /** Per-role isolation bucket: 'main' (main agent incl. in-place /role switch),
   *  '<roleName>' (spawned role subagent, e.g. 'researcher'), 'shared'
   *  (cross-role read-only namespace). Defaults to 'main'. The agent
   *  self-identifies via this param (agentic pattern). */
  role?: string;
  /** Intrinsic hardness (0-1), distinct from confidence (which decays with
   *  recency). High for schema/API/config facts, low for transient preferences.
   *  Defaults by type (fact/procedure=0.8, correction/decision=0.6,
   *  preference=0.3) — RESEARCH CAVEAT: values are推理需实战验证, mechanism
   *  is强证据 (GenAgents importance, CrewAI importance_weight). */
  importance?: number;
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
  /** GM-7: when this fact became valid (NULL for pre-migration rows = always). */
  validFrom: number | null;
  /** GM-7: when this fact was superseded/expired (NULL = still current). */
  validTo: number | null;
  supersededBy: string | null;
  /** Per-role isolation bucket: 'main' | '<roleName>' | 'shared'. */
  role: string;
  /** Intrinsic hardness (0-1). High = schema/API/config (抗衰减). */
  importance: number;
}

export interface SearchOptions {
  type?: MemoryType;
  project?: string;
  limit?: number;
  status?: MemoryStatus;
  /** GM-7: query memories valid at this timestamp (valid_from <= asOf AND
   *  (valid_to IS NULL OR valid_to > asOf)). Omit to leave validity unfiltered
   *  (default, non-breaking) — callers wanting current-only use status:'active'. */
  asOf?: number;
  /** Per-role isolation filter. When set, only memories where
   *  role === this value OR role === 'shared' are returned (prevents串味:
   *  a spawned role's search does not surface another role's private
   *  memories). Omit to search across all roles (admin/regen use only). */
  role?: string;
  /** v3 refresh-on-access: when true, returned memories have confidence
   *  restored (MIN(1.0, +0.2)) + last_access updated. Set by search/recall
   *  TOOLS (real user access); false for internal callers (regen/consolidation). */
  refreshOnAccess?: boolean;
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
