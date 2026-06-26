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
    // Backdate valid_from to FIXED deterministic timestamps to eliminate the
    // ms-race flake (beforeSuper vs 2nd-write validFrom landing in different ms).
    const t0 = Date.now() - 10000;
    const m1 = mgr.write(createSampleMemory({ content: 'temporal fact dup', project: 'p', confidence: 1.0 }));
    const m2 = mgr.write(createSampleMemory({ content: 'temporal fact dup', project: 'p', confidence: 0.5 }));
    mgr.runSql('UPDATE memories SET valid_from = ? WHERE id = ?', [t0, m1.id]);
    mgr.runSql('UPDATE memories SET valid_from = ? WHERE id = ?', [t0 + 1, m2.id]);
    const beforeSuper = t0 + 5000; // deterministically AFTER both valid_from, BEFORE merge
    const engine = new ConsolidationEngine(mgr);
    await engine.runMerge('p', 0.6);
    // Identify the superseded memory (its valid_to was set by merge). The
    // test's INTENT: at a past asOf (before supersede), the since-superseded
    // fact was still valid → returned.
    const all = mgr.getAll('p');
    const superseded = all.find(m => m.status === 'superseded')!;
    const afterSuper = Date.now() + 1;
    // Historical asOf (before supersede): superseded fact's valid_from <= asOf
    // and valid_to (set at merge, after beforeSuper) > asOf → still valid → returned.
    const historical = mgr.search('temporal fact', { project: 'p', asOf: beforeSuper });
    expect(historical.some(r => r.memory.id === superseded.id)).toBe(true);
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
