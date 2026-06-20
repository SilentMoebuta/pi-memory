// GM-1: the real embedding model loader (the IMPURE part — @xenova/transformers
// downloads ~23MB on first load). Kept separate from the pure fusion math
// (src/memory/hybrid.ts) so unit tests never trigger a download. Exercised by
// a live probe (scripts/probe-gm1-embeddings.ts). The search boundary injects
// the `embed` callable produced here into MemoryManager only when config
// [search] hybrid=true (default off = zero model cost, zero download).

// Lazily imported so requiring this module never pulls transformers unless
// embeddings are actually enabled.
type EmbedFn = (text: string) => Promise<Float32Array>;
let cached: EmbedFn | null = null;

/**
 * Build (and memoize) an embed callable backed by @xenova/transformers.
 * Defaults to Xenova/all-MiniLM-L6-v2 (384-dim, ~23MB) — small, local, and
 * strong enough for personal agent memory. Pass modelName to override.
 *
 * Returned vectors are Float32Array (unit-ish; cosineSimilarity normalizes).
 */
export async function getEmbedder(modelName = 'Xenova/all-MiniLM-L6-v2'): Promise<EmbedFn> {
	if (cached) return cached;
	// Dynamic import keeps the (heavy) transformers module out of the main
	// require graph unless hybrid search is enabled.
	const { pipeline } = await import('@xenova/transformers');
	const extractor = await pipeline('feature-extraction', modelName, { quantized: true });
	cached = async (text: string): Promise<Float32Array> => {
		const out = await extractor(text, { pooling: 'mean', normalize: true });
		// @xenova returns a Tensor; coerce to a plain Float32Array view.
		return (out as unknown as { data: Float32Array }).data;
	};
	return cached;
}

// ponytail: embeddings are computed on-the-fly at search time (searchHybrid embeds
// the query + each candidate's content). Per-memory BLOB storage + backfill is
// a YAGNI optimization — add it only if on-the-fly embedding is measurably
// slow for a real memory corpus (hundreds, not millions, of memories).
