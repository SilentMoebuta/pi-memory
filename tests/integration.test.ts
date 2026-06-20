import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { MemoryManager } from '../src/memory/memoryManager';
import { CREATE_TABLES, INIT_VERSION, MIGRATE_V2_STATEMENTS } from '../src/memory/schema';
import { ConsolidationEngine } from '../src/consolidation/engine';
import { ContextInjector } from '../src/context/injector';

describe('End-to-end integration', () => {
  it('full pipeline: write → search → recall → forget → consolidate → context', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(CREATE_TABLES);
    db.run(INIT_VERSION);
    for (const stmt of MIGRATE_V2_STATEMENTS) {
      try { db.run(stmt); } catch { /* GM-7: column already exists */ }
    }
    const manager = new MemoryManager(db);

    // Write
    const m1 = manager.write({ type: 'preference', content: '用户喜欢用 vitest 而非 jest', project: 'test' });
    expect(m1.id).toBeDefined();
    manager.write({ type: 'decision', content: '后端使用 JWT 认证', project: 'test' });
    manager.write({ type: 'procedure', content: '部署用 Docker + GitHub Actions', project: 'test' });

    // Search
    const results = manager.search('Docker');
    expect(results.length).toBeGreaterThan(0);

    // Recall
    const recall = manager.recall('认证', 'test');
    expect(recall.combined.length).toBeGreaterThan(0);

    // Forget
    expect(manager.forget(m1.id)).toBe(true);
    expect(manager.get(m1.id)!.status).toBe('deleted');

    // Stats
    const stats = manager.getStats('test');
    expect(stats.total).toBeGreaterThanOrEqual(1);

    // Consolidation
    const engine = new ConsolidationEngine(manager);
    const decay = engine.runDecay('test', 30, 90);
    expect(decay.decayed).toBeGreaterThanOrEqual(0);

    // Context injection
    const injector = new ContextInjector(manager);
    const ctx = injector.buildContext('test');
    expect(ctx).toContain('Memory');
    expect(ctx.length).toBeGreaterThan(0);
  });
});
