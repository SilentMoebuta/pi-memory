import { describe, it, expect } from 'vitest';
import { cosineSimilarity, normalizeBm25, fuseHybrid, type HybridWeights } from '../src/memory/hybrid';

// GM-1+GM-2: hybrid retrieval fusion (semantic + sigmoid-normalized BM25,
// additive). The fusion MATH is pure + unit-tested here with fake vectors;
// the real embedding model (@xenova/transformers, loaded lazily) is exercised
// by a live probe (scripts/probe-gm1-embeddings.ts) — mirroring the GM-9
// injectable-embedder pattern so unit tests never download a model.

describe('GM-1/GM-2 hybrid fusion (pure math)', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
    });
    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });
    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
    });
    it('returns 0 when either vector has zero magnitude (no NaN)', () => {
      expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
    });
  });

  describe('normalizeBm25 (sigmoid, query-length-adaptive like mem0)', () => {
    it('maps a 0 score to ~0 and a large score toward 1', () => {
      expect(normalizeBm25(0, 1)).toBeCloseTo(0, 6);
      expect(normalizeBm25(100, 1)).toBeGreaterThan(0.99);
    });
    it('is monotonic (higher raw -> higher normalized)', () => {
      const a = normalizeBm25(2, 3);
      const b = normalizeBm25(5, 3);
      expect(b).toBeGreaterThan(a);
    });
    it('scales the normalization by query length (longer query -> gentler -> lower for the same raw)', () => {
      // A raw BM25 score of 5 is a stronger match for a 1-word query than for a
      // 5-word query, so the longer-query normalization is gentler (less saturated)
      // for the same raw score — mirroring mem0's query-length-adaptive k.
      const short = normalizeBm25(5, 1);
      const long = normalizeBm25(5, 5);
      expect(long).toBeLessThan(short);
    });
  });

  describe('fuseHybrid (additive fusion)', () => {
    const weights: HybridWeights = { bm25: 1.0, semantic: 1.0 };
    it('sums normalized BM25 and cosine (both in [0,1] after clamping)', () => {
      // bm25 raw -> normalized ~1, cosine = 0.5 => fused ~1.5
      const fused = fuseHybrid({ bm25Raw: 50, queryLen: 1, cosine: 0.5 }, weights);
      expect(fused).toBeGreaterThan(1.4);
      expect(fused).toBeLessThan(1.6);
    });
    it('gives 0 when both signals are 0', () => {
      expect(fuseHybrid({ bm25Raw: 0, queryLen: 1, cosine: 0 }, weights)).toBeCloseTo(0, 6);
    });
    it('respects weights (zero semantic weight => pure BM25)', () => {
      const w: HybridWeights = { bm25: 1.0, semantic: 0 };
      const pure = fuseHybrid({ bm25Raw: 50, queryLen: 1, cosine: 1.0 }, w);
      const bm25only = normalizeBm25(50, 1);
      expect(pure).toBeCloseTo(bm25only, 6);
    });
    it('clamps cosine from [-1,1] into [0,1] before weighting (negative = no boost)', () => {
      const pos = fuseHybrid({ bm25Raw: 10, queryLen: 1, cosine: 0.9 }, weights);
      const neg = fuseHybrid({ bm25Raw: 10, queryLen: 1, cosine: -0.9 }, weights);
      expect(pos).toBeGreaterThan(neg);
      // negative cosine contributes 0, not a subtraction
      const zero = fuseHybrid({ bm25Raw: 10, queryLen: 1, cosine: 0 }, weights);
      expect(neg).toBeCloseTo(zero, 6);
    });
  });
});
