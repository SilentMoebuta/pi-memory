export const SCHEMA_VERSION = 4;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('fact','decision','preference','procedure','correction')),
    content TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    access_count INT DEFAULT 0,
    last_access INTEGER,
    created_at INTEGER NOT NULL,
    session_id TEXT,
    project TEXT NOT NULL,
    source TEXT DEFAULT 'agent' CHECK(source IN ('agent','user','consolidated')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','archived','superseded','deleted')),
    superseded_by TEXT
);

CREATE TABLE IF NOT EXISTS consolidation_cursor (
    project TEXT PRIMARY KEY,
    last_processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memories(project, type);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_project_created ON memories(project, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_version (
    version INT PRIMARY KEY
);
`;

export const INIT_VERSION = `
INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION});
`;

/**
 * GM-7: temporal validity windows migration. Adds nullable valid_from /
 * valid_to columns so a superseded fact records when it stopped being
 * current (valid_to) and stays queryable via search asOf a past timestamp.
 *
 * Idempotent: ALTER TABLE ADD COLUMN errors if the column already exists, so
 * each statement is wrapped by the caller in try/catch. Run after CREATE_TABLES
 * in both the extension (src/index.ts) and the test helper (tests/helpers.ts)
 * so every DB — new or pre-existing v1 — gets the columns via one path.
 */
export const MIGRATE_V2_STATEMENTS = [
  'ALTER TABLE memories ADD COLUMN valid_from INTEGER',
  'ALTER TABLE memories ADD COLUMN valid_to INTEGER',
];

/**
 * V3 migration: per-role memory isolation.
 *
 * Adds `role` column (default 'main') so memories are partitioned by
 * (project, role) instead of just (project). Values: 'main' (main agent,
 * including in-place /role persona switches — see main_agent_persona_memory_research.md),
 * '<roleName>' (spawn_role subagents, e.g. 'researcher'/'coder'), 'shared'
 * (cross-role read-only shared knowledge, e.g. generic methodology).
 *
 * Two statements: (1) ADD COLUMN with DEFAULT 'main' (applies to NEW rows),
 * (2) UPDATE backfill existing v2 rows that got NULL on ALTER (SQLite ALTER
 * ADD COLUMN with DEFAULT only defaults new rows, not existing). Both are
 * idempotent — wrapped in try/catch by callers (column-add errors if exists;
 * UPDATE is a no-op once all rows are non-NULL).
 *
 * Rationale (research-backed): controlled sharing, not full isolation.
 * Letta/Claude Code/CrewAI all default to per-agent bucketing with opt-in
 * sharing. 'shared' sentinel is the opt-in shared namespace (read-only by
 * the injector layer). See multi_agent_memory_isolation_research.md.
 */
export const MIGRATE_V3_STATEMENTS = [
  "ALTER TABLE memories ADD COLUMN role TEXT NOT NULL DEFAULT 'main'",
  "UPDATE memories SET role = 'main' WHERE role IS NULL",
];

/**
 * V4 migration: importance dimension for抗衰减 ranking.
 *
 * Adds `importance` column (REAL, default 0.5). Distinct from confidence
 * (which decays with recency): importance is the INTRINSIC hardness of the
 * fact (schema/API/config = high; transient preference = low). High-importance
 *硬事实 ranks above decayed low-importance memories in empty-query fallback.
 *
 * Type-based defaults assigned at write time (see MemoryManager.write) —
 * RESEARCH CAVEAT (memory_retention_strategy_research.md): exact default
 * values are推理, need实战验证; the MECHANISM (importance as a ranking
 * dimension separate from recency) is强证据 (GenAgents importance, CrewAI
 * importance_weight 0.4).
 */
export const MIGRATE_V4_STATEMENTS = [
  "ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5",
  "UPDATE memories SET importance = 0.5 WHERE importance IS NULL",
];
