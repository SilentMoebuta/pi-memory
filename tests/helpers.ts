import initSqlJs, { Database } from 'sql.js';
import { CREATE_TABLES, INIT_VERSION } from '../src/memory/schema';
import { Memory, MemoryInput } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

let SQL: any = null;

export async function createTestDb(): Promise<Database> {
  if (!SQL) SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(CREATE_TABLES);
  db.run(INIT_VERSION);
  return db;
}

export function createSampleMemory(overrides: Partial<MemoryInput> = {}): MemoryInput {
  return {
    type: 'fact',
    content: 'The project uses TypeScript with strict mode',
    project: 'test-project',
    ...overrides,
  };
}

export function insertMemory(db: Database, input: MemoryInput): Memory {
  const id = uuidv4();
  const now = Date.now();
  db.run(
    `INSERT INTO memories (id, type, content, confidence, access_count, created_at, session_id, project, source, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')`,
    [id, input.type, input.content, input.confidence ?? 1.0, now, input.sessionId ?? null, input.project ?? 'test-project', input.source ?? 'agent']
  );
  return {
    id, type: input.type, content: input.content,
    confidence: input.confidence ?? 1.0,
    accessCount: 0, lastAccess: null, createdAt: now,
    sessionId: input.sessionId ?? null,
    project: input.project ?? 'test-project',
    source: input.source ?? 'agent',
    status: 'active', supersededBy: null,
  };
}

export function insertSampleMemories(db: Database, count: number, project = 'test-project'): Memory[] {
  const memories: Memory[] = [];
  for (let i = 0; i < count; i++) {
    memories.push(insertMemory(db, {
      type: 'fact',
      content: `Sample memory ${i}: This is a test memory about TypeScript configuration and project setup`,
      project,
    }));
  }
  return memories;
}
