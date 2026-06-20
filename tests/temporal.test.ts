import { describe, it, expect } from 'vitest';
import { createTestDb, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';
import { ConsolidationEngine } from '../src/consolidation/engine';

// GM-7: temporal fact validity windows. A superseded fact records valid_to
// (the time it was superseded) and stays queryable via search asOf a past
// timestamp — Graphiti-style coexistence of superseded facts for historical
// queries. Default search (no asOf) is unchanged (non-breaking); callers that
// want current-only keep using status:'active'.

describe('GM-7 temporal validity windows', () => {
  it('migration adds valid_from / valid_to columns (idempotent, run by createTestDb)', async () => {
    const db = await createTestDb();
    const cols = db.exec("PRAGMA table_info(memories)")[0].values.map((r: any[]) => r[1]);
    expect(cols).toContain('valid_from');
    expect(cols).toContain('valid_to');
  });

  it('write() sets valid_from = createdAt and leaves valid_to null (open-ended)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    const m = mgr.write(createSampleMemory({ content: 'fact A', project: 'p' }));
    expect(m.validFrom).toBe(m.createdAt);
    expect(m.validTo).toBeNull();
  });

  it('runMerge supersede sets valid_to = now on the removed memory; keeper stays open', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'dup xyz', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'dup xyz', project: 'p', confidence: 0.5 }));
    const engine = new ConsolidationEngine(mgr);
    const { merged } = await engine.runMerge('p', 0.6);
    expect(merged).toBe(1);
    const all = mgr.getAll('p');
    const removed = all.find(m => m.status === 'superseded')!;
    const keeper = all.find(m => m.status === 'active')!;
    expect(removed).toBeTruthy();
    expect(keeper).toBeTruthy();
    expect(removed.validTo).not.toBeNull();
    expect(removed.validTo!).toBeLessThanOrEqual(Date.now());
    expect(keeper.validTo).toBeNull();
  });

  it('search asOf filters by validity window: past-asOf returns since-superseded fact, future-asOf excludes it', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    // Two facts; merge supersedes the lower-confidence one (sets its valid_to).
    mgr.write(createSampleMemory({ content: 'temporal fact dup', project: 'p', confidence: 1.0 }));
    const beforeSuper = Date.now();
    mgr.write(createSampleMemory({ content: 'temporal fact dup', project: 'p', confidence: 0.5 }));
    const engine = new ConsolidationEngine(mgr);
    await engine.runMerge('p', 0.6);
    const afterSuper = Date.now() + 1;
    // Historical asOf (between write and supersede): the since-superseded fact
    // was valid then, so BOTH facts match the query.
    const historical = mgr.search('temporal fact', { project: 'p', asOf: beforeSuper });
    expect(historical.length).toBeGreaterThanOrEqual(2);
    // Future/current asOf: the superseded fact's valid_to <= afterSuper, so
    // only the keeper is valid.
    const current = mgr.search('temporal fact', { project: 'p', asOf: afterSuper });
    expect(current.length).toBe(1);
    expect(current[0].memory.status).toBe('active');
  });

  it('search with no asOf is unchanged — superseded memory still appears (non-breaking)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'nodefault dup', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'nodefault dup', project: 'p', confidence: 0.5 }));
    const engine = new ConsolidationEngine(mgr);
    await engine.runMerge('p', 0.6);
    // No asOf: no valid_to filtering -> both keeper + superseded appear
    // (callers wanting current-only use status:'active', as before).
    const all = mgr.search('nodefault', { project: 'p' });
    expect(all.length).toBe(2);
  });
});
