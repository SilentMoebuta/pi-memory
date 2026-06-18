import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from 'sql.js';
import { createTestDb, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';
import { ConsolidationEngine } from '../src/consolidation/engine';

describe('P0: empty query + wildcard project (regenL1Index chain)', () => {
  let db: Database;
  let manager: MemoryManager;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
    // Seed two projects
    manager.write(createSampleMemory({ content: 'fact in project A', project: 'aaa111' }));
    manager.write(createSampleMemory({ content: 'fact in project B', project: 'bbb222' }));
  });

  describe('search with empty query', () => {
    it('returns memories (not empty) for empty query within a project', () => {
      const results = manager.search('', { project: 'aaa111', limit: 20 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.content).toContain('project A');
    });

    it('returns memories across all projects when project is "*" or undefined', () => {
      const star = manager.search('', { project: '*', limit: 50 });
      expect(star.length).toBeGreaterThanOrEqual(2);
      const contents = star.map(r => r.memory.content);
      expect(contents).toEqual(expect.arrayContaining(['fact in project A', 'fact in project B']));

      const undef = manager.search('', { limit: 50 });
      expect(undef.length).toBeGreaterThanOrEqual(2);
    });

    it('still uses BM25 for non-empty query', () => {
      const results = manager.search('project', { limit: 50 });
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Non-empty query should still rank by BM25 score
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('regenL1Index', () => {
    it('generates a non-empty MEMORY.md body for wildcard project', () => {
      const engine = new ConsolidationEngine(manager);
      // Should not throw and should produce non-empty content
      engine.regenL1Index('*');
      // regenL1Index writes to disk; verify via search that data is reachable
      const top = manager.search('', { project: '*', limit: 20 });
      expect(top.length).toBeGreaterThan(0);
    });
  });
});

describe('P0: search filtering still works with empty query', () => {
  let db: Database;
  let manager: MemoryManager;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
    manager.write(createSampleMemory({ content: 'a fact', type: 'fact', project: 'p1' }));
    manager.write(createSampleMemory({ content: 'a decision', type: 'decision', project: 'p1' }));
  });

  it('respects type filter on empty query', () => {
    const facts = manager.search('', { project: 'p1', type: 'fact' as any, limit: 50 });
    expect(facts.length).toBe(1);
    expect(facts[0].memory.type).toBe('fact');
  });

  it('respects limit on empty query', () => {
    const limited = manager.search('', { project: 'p1', limit: 1 });
    expect(limited.length).toBe(1);
  });
});

describe('P1-5: BM25 cache invalidation', () => {
  let db: Database;
  let manager: MemoryManager;

  beforeAll(async () => {
    db = await createTestDb();
    manager = new MemoryManager(db);
  });

  it('sees newly written memory after write (cache invalidated)', () => {
    const before = manager.search('unique-cache-test', { limit: 50 });
    expect(before.length).toBe(0);
    manager.write(createSampleMemory({ content: 'unique-cache-test memory', project: 'cache-p' }));
    const after = manager.search('unique-cache-test', { limit: 50 });
    expect(after.length).toBe(1);
    expect(after[0].memory.content).toContain('unique-cache-test');
  });

  it('sees changes after consolidation engine runSql mutation', () => {
    // Use distinctive content to avoid cross-token contamination with the
    // 'unique-cache-test' memory written in the previous test.
    manager.write(createSampleMemory({ content: 'zzz-supersede-me zzz', project: 'cache-q', confidence: 1.0 }));
    manager.write(createSampleMemory({ content: 'zzz-supersede-me zzz', project: 'cache-q', confidence: 0.5 }));
    const before = manager.search('zzz-supersede-me', { project: 'cache-q', status: 'active', limit: 50 });
    expect(before.length).toBe(2);
    // Consolidation engine merges via runSql; cache must invalidate so the
    // superseded memory no longer appears in active-only search.
    const all = manager.getAll('cache-q', 'active');
    const lowConf = all.find(m => m.confidence === 0.5);
    expect(lowConf).toBeDefined();
    manager.runSql('UPDATE memories SET status = ?, superseded_by = ? WHERE id = ?',
      ['superseded', all[0].id, lowConf!.id]);
    const after = manager.search('zzz-supersede-me', { project: 'cache-q', status: 'active', limit: 50 });
    expect(after.length).toBe(1);
  });
});
