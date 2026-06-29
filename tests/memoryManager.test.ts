import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from 'sql.js';
import { createTestDb, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';

describe('MemoryManager', () => {
  let db: Database;
  let manager: MemoryManager;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
  });

  describe('write', () => {
    it('should insert a memory and return it with an id', () => {
      const memory = manager.write(createSampleMemory());
      expect(memory.id).toBeDefined();
      expect(memory.type).toBe('fact');
      expect(memory.content).toContain('TypeScript');
      expect(memory.status).toBe('active');
      expect(memory.confidence).toBe(1.0);
    });

    it('should use custom confidence when provided', () => {
      const memory = manager.write(createSampleMemory({ confidence: 0.8 }));
      expect(memory.confidence).toBe(0.8);
    });
  });

  describe('get', () => {
    it('should retrieve a memory by id', () => {
      const written = manager.write(createSampleMemory({ content: 'unique test content' }));
      const retrieved = manager.get(written.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe('unique test content');
    });

    it('should return null for non-existent id', () => {
      expect(manager.get('non-existent-id')).toBeNull();
    });

    it('should increment accessCount on get', () => {
      const written = manager.write(createSampleMemory());
      manager.get(written.id);
      const retrieved = manager.get(written.id);
      expect(retrieved!.accessCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('forget', () => {
    it('should soft-delete a memory', () => {
      const written = manager.write(createSampleMemory());
      const result = manager.forget(written.id);
      expect(result).toBe(true);
      const retrieved = manager.get(written.id);
      expect(retrieved!.status).toBe('deleted');
    });

    it('should return false for non-existent id', () => {
      expect(manager.forget('non-existent')).toBe(false);
    });
  });

  describe('search', () => {
    it('should find memories by keyword', () => {
      manager.write(createSampleMemory({ content: 'Docker deployment on AWS ECS', type: 'procedure' }));
      manager.write(createSampleMemory({ content: 'Use TypeScript for all new projects', type: 'preference' }));

      const results = manager.search('TypeScript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should filter by type', () => {
      manager.write(createSampleMemory({ content: 'Docker type filter test keyword xyz123', type: 'procedure' }));
      manager.write(createSampleMemory({ content: 'Docker type filter test keyword xyz123', type: 'fact' }));

      const results = manager.search('Docker', { type: 'procedure' as any });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.memory.type).toBe('procedure');
      }
    });

    it('should exclude deleted memories', () => {
      const mem = manager.write(createSampleMemory({ content: 'unique deleted test content xyz' }));
      manager.forget(mem.id);
      const results = manager.search('deleted test');
      const found = results.find(r => r.memory.id === mem.id);
      expect(found).toBeUndefined();
    });
  });

  describe('recall', () => {
    it('should return L2 and L3 results', async () => {
      manager.write(createSampleMemory({ content: 'Authentication uses JWT tokens', type: 'decision' }));
      manager.write(createSampleMemory({ content: 'Deploy to AWS using GitHub Actions', type: 'procedure' }));
      const result = await manager.recall('AWS', 'test-project');
      expect(result.combined.length).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return memory statistics', () => {
      manager.write(createSampleMemory({ type: 'fact' }));
      manager.write(createSampleMemory({ type: 'decision' }));
      manager.write(createSampleMemory({ type: 'preference' }));

      const stats = manager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.byType['fact']).toBeGreaterThanOrEqual(1);
      expect(stats.byType['decision']).toBeGreaterThanOrEqual(1);
      expect(stats.avgConfidence).toBeGreaterThan(0);
    });
  });
});

describe('MemoryManager mutation hook (onMutation)', () => {
  it('fires onMutation after write()', async () => {
    const d = await createTestDb();
    const m = new MemoryManager(d);
    let calls = 0;
    m.onMutation = () => { calls++; };
    m.write(createSampleMemory());
    expect(calls).toBe(1);
  });

  it('fires onMutation after forget()', async () => {
    const d = await createTestDb();
    const m = new MemoryManager(d);
    const mem = m.write(createSampleMemory());
    let calls = 0;
    m.onMutation = () => { calls++; };
    m.forget(mem.id);
    expect(calls).toBe(1);
  });

  it('fires onMutation after runSql() that touches the memories table', async () => {
    const d = await createTestDb();
    const m = new MemoryManager(d);
    const mem = m.write(createSampleMemory());
    let calls = 0;
    // Reset so the write() above doesn't count
    m.onMutation = () => { calls++; };
    m.runSql('UPDATE memories SET confidence = ? WHERE id = ?', [0.5, mem.id]);
    expect(calls).toBe(1);
  });

  it('does NOT fire onMutation for runSql() on a non-memories table', async () => {
    const d = await createTestDb();
    const m = new MemoryManager(d);
    let calls = 0;
    m.onMutation = () => { calls++; };
    m.runSql('INSERT OR REPLACE INTO consolidation_cursor (project, last_processed_at) VALUES (?, ?)', ['p', 1]);
    expect(calls).toBe(0);
  });
});

// ── P1-4: getStats byRole 维度 ──────────────────────────────────────────────

describe('P1-4: getStats includes role dimension', () => {
  it('byRole counts memories per role bucket', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write({ type: 'fact', content: 'main fact', project: 'p', role: 'main' } as any);
    mgr.write({ type: 'fact', content: 'main fact 2', project: 'p', role: 'main' } as any);
    mgr.write({ type: 'fact', content: 'researcher fact', project: 'p', role: 'researcher' } as any);
    mgr.write({ type: 'fact', content: 'shared', project: 'p', role: 'shared' } as any);
    const stats = mgr.getStats('p');
    expect(stats.byRole).toBeDefined();
    expect(stats.byRole['main']).toBe(2);
    expect(stats.byRole['researcher']).toBe(1);
    expect(stats.byRole['shared']).toBe(1);
  });

  it('byRole undefined when no memories', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const stats = mgr.getStats('empty-project');
    expect(stats.byRole).toEqual({});
  });
});
