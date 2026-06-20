import { describe, it, expect } from 'vitest';
import { createTestDb, createSampleMemory } from './helpers';
import { MemoryManager } from '../src/memory/memoryManager';

// GM-1+GM-2 part 2: searchHybrid uses an injected embedder to fuse semantic
// (cosine) with BM25. The embedder is injected (real @xenova path is exercised
// by scripts/probe-gm1-embeddings.ts), so this test uses a deterministic fake
// embedder and asserts that semantic similarity re-ranks results that plain
// BM25 would order differently.

// Fake embedder: content with 'alpha' -> [1,0]; with 'gamma' -> [0,1];
// the bare query 'common' (neither) -> [1,0] (favors alpha), so semantic
// similarity lifts the alpha memory above a higher-BM25 gamma one.
function fakeEmbedder(text: string): Promise<Float32Array> {
  let v: number[];
  if (/alpha/.test(text)) v = [1, 0];
  else if (/gamma/.test(text)) v = [0, 1];
  else v = [1, 0];
  return Promise.resolve(new Float32Array(v));
}

describe('GM-1+GM-2 searchHybrid (semantic rerank via injected embedder)', () => {
  it('reranks a semantically-closer memory above a higher-BM25 one', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db, { embedder: fakeEmbedder });
    // "alpha" memory: lower BM25 for "common" (1 occurrence) but semantically
    // close to the query embedding ([1,0]).
    const alpha = mgr.write(createSampleMemory({ content: 'common alpha', project: 'p' }));
    // "gamma" memory: higher BM25 for "common" (3 occurrences) but semantically
    // far ([0,1]). Plain BM25 ranks gamma first.
    mgr.write(createSampleMemory({ content: 'common common common gamma', project: 'p' }));

    const plain = mgr.search('common', { project: 'p' });
    expect(plain[0].memory.id).not.toBe(alpha.id); // BM25 ranks the 3x one first

    const hybrid = await mgr.searchHybrid('common', { project: 'p' });
    expect(hybrid[0].memory.id).toBe(alpha.id); // semantic flips alpha to top
  });

  it('falls back to plain BM25 when no embedder is configured', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db); // no embedder
    mgr.write(createSampleMemory({ content: 'common alpha', project: 'p' }));
    mgr.write(createSampleMemory({ content: 'common common common gamma', project: 'p' }));
    const hybrid = await mgr.searchHybrid('common', { project: 'p' });
    const plain = mgr.search('common', { project: 'p' });
    expect(hybrid.map(r => r.memory.id)).toEqual(plain.map(r => r.memory.id));
  });

  it('falls back to BM25 for an empty query (no embedding needed)', async () => {
    const db = await createTestDb();
    const mgr = new MemoryManager(db, { embedder: fakeEmbedder });
    mgr.write(createSampleMemory({ content: 'common alpha', project: 'p' }));
    const hybrid = await mgr.searchHybrid('', { project: 'p' });
    expect(hybrid.length).toBeGreaterThan(0);
  });
});
