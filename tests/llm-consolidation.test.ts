import { describe, it, expect } from 'vitest';
import { createTestDb, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';
import { ConsolidationEngine } from '../src/consolidation/engine';

// GM-9: opt-in LLM-driven consolidation. When an llmMerge callable is injected
// into ConsolidationEngine, runMerge asks it to propose a merged memory for
// high-similarity pairs instead of the pure jaccard union; on throw/null it
// falls back to jaccard (graceful degradation). The engine stays model-agnostic
// (the callable is built from ctx.model in the /memory-consolidate command).

describe('GM-9 LLM-driven consolidation (opt-in, graceful fallback)', () => {
  it('uses the llmMerge result as the keeper content when it returns a string', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'the api uses rest', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'the api uses rest', project: 'p', confidence: 0.5 }));
    const llmMerge = async (a: string, b: string) => `MERGED(${a} | ${b})`;
    const engine = new ConsolidationEngine(mgr, { llmMerge });
    const { merged } = await engine.runMerge('p', 0.6);
    expect(merged).toBe(1);
    const all = mgr.getAll('p');
    const keeper = all.find(m => m.status === 'active')!;
    expect(keeper.content).toBe('MERGED(the api uses rest | the api uses rest)');
  });

  it('falls back to jaccard when llmMerge throws (no crash, keeper content unchanged)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'fallback dup xyz', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'fallback dup xyz', project: 'p', confidence: 0.5 }));
    const llmMerge = async () => { throw new Error('provider down'); };
    const engine = new ConsolidationEngine(mgr, { llmMerge });
    const { merged } = await engine.runMerge('p', 0.6);
    expect(merged).toBe(1); // still merged via jaccard fallback
    const keeper = mgr.getAll('p').find(m => m.status === 'active')!;
    expect(keeper.content).toBe('fallback dup xyz'); // unchanged (no LLM content)
  });

  it('falls back to jaccard when llmMerge returns null', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'nullmerge dup', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'nullmerge dup', project: 'p', confidence: 0.5 }));
    const engine = new ConsolidationEngine(mgr, { llmMerge: async () => null });
    const { merged } = await engine.runMerge('p', 0.6);
    expect(merged).toBe(1);
    const keeper = mgr.getAll('p').find(m => m.status === 'active')!;
    expect(keeper.content).toBe('nullmerge dup');
  });

  it('without llmMerge, runMerge is unchanged (jaccard, keeper content unchanged)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db);
    mgr.write(createSampleMemory({ content: 'plain dup', project: 'p', confidence: 1.0 }));
    mgr.write(createSampleMemory({ content: 'plain dup', project: 'p', confidence: 0.5 }));
    const engine = new ConsolidationEngine(mgr); // no llmMerge
    const { merged } = await engine.runMerge('p', 0.6);
    expect(merged).toBe(1);
    const keeper = mgr.getAll('p').find(m => m.status === 'active')!;
    expect(keeper.content).toBe('plain dup');
  });
});
