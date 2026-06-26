import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from 'sql.js';
import { createTestDb, insertMemory, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';
import { ConsolidationEngine } from '../src/consolidation/engine';

describe('ConsolidationEngine', () => {
  let db: Database;
  let manager: MemoryManager;
  let engine: ConsolidationEngine;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
    engine = new ConsolidationEngine(manager);
  });

  describe('runDecay', () => {
    it('should decay old memories', () => {
      const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
      db.run('INSERT INTO memories (id, type, content, confidence, created_at, project, source, status) VALUES (?,?,?,?,?,?,?,?)',
        ['old1', 'fact', 'Old fact', 1.0, oldTime, 'test', 'agent', 'active']);
      const result = engine.runDecay('test', 30, 90);
      expect(result.decayed).toBeGreaterThanOrEqual(1);
      const mem = manager.get('old1');
      expect(mem!.confidence).toBeLessThan(1.0);
    });

    it('v3: very old memories stay active (L3 permanent, no time-archiving)', () => {
      const veryOld = Date.now() - 91 * 24 * 60 * 60 * 1000;
      db.run('INSERT INTO memories (id, type, content, confidence, created_at, project, source, status) VALUES (?,?,?,?,?,?,?,?)',
        ['old2', 'fact', 'Very old fact', 1.0, veryOld, 'test', 'agent', 'active']);
      engine.runDecay('test', 30, 90);
      const mem = manager.get('old2');
      expect(mem!.status).toBe('active'); // v3: L3 permanent — no time-archiving
    });

    it('should not decay recent memories', () => {
      const mem = manager.write(createSampleMemory({ content: 'Recent memory' }));
      engine.runDecay('test', 30, 90);
      const retrieved = manager.get(mem.id);
      expect(retrieved!.confidence).toBe(1.0);
    });
  });
});
