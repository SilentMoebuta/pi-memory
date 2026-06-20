// GM-1+GM-2: hybrid retrieval fusion math (pure, unit-tested in tests/hybrid.test.ts).
//
// The real embedding model (@xenova/transformers) is loaded lazily by the
// embedder injected at the search boundary (see src/index.ts); this module
// owns only the fusion arithmetic so it can be tested with fake vectors and
// never triggers a model download. Mirrors the mem0 additive-fusion design
// (sigmoid-style saturating BM25 normalization + clamped cosine), adapted to
// pi-memory's zero-infra local-embedding stance.

export interface HybridWeights {
	/** Weight applied to the normalized BM25 term. Default 1.0. */
	bm25: number;
	/** Weight applied to the clamped cosine term. Default 1.0. */
	semantic: number;
}

/** Cosine similarity in [-1, 1]. Returns 0 when either vector has zero
 *  magnitude (avoids NaN from division by zero). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const av = a[i];
		const bv = b[i];
		dot += av * bv;
		normA += av * av;
		normB += bv * bv;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Sigmoid-style saturating normalization of a raw BM25 score into [0, 1):
 *  `raw / (raw + k)` where k = max(1, queryLen). Maps 0 -> 0, large -> 1, and
 *  is query-length-adaptive: a longer query yields a larger k so the same raw
 *  score normalizes lower (gentler), matching mem0's query-length-adaptive BM25
 *  normalization. */
export function normalizeBm25(rawBm25: number, queryLen: number): number {
	const k = Math.max(1, queryLen);
	return rawBm25 / (rawBm25 + k);
}

/** Additive hybrid fusion: `w_bm25 * normalizeBm25(raw, len) + w_semantic * max(0, cosine)`.
 *  Cosine is clamped from [-1, 1] into [0, 1] first — a negatively-correlated
 *  memory contributes 0 semantic boost, never a subtraction (matches mem0's
 *  additive fusion where only positive semantic overlap boosts). */
export function fuseHybrid(
	input: { bm25Raw: number; queryLen: number; cosine: number },
	weights: HybridWeights,
): number {
	const bm25Term = normalizeBm25(input.bm25Raw, input.queryLen);
	const semanticTerm = Math.max(0, input.cosine);
	return weights.bm25 * bm25Term + weights.semantic * semanticTerm;
}
