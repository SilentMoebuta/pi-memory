export const SCHEMA_VERSION = 2;

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

-- TODO(v2): populate memory_links in consolidate() for contradiction/refinement detection
CREATE TABLE IF NOT EXISTS memory_links (
    source_id TEXT REFERENCES memories(id),
    target_id TEXT REFERENCES memories(id),
    relation TEXT CHECK(relation IN ('contradicts','refines','relates_to')),
    PRIMARY KEY (source_id, target_id, relation)
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
