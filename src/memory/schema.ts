export const SCHEMA_VERSION = 1;

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
