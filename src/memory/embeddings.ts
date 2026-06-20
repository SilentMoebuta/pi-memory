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
		const data = (out as unknown as { data: Float32Array }).data;
		return data;
	};
	return cached;
}

/** Serialize a Float32Array to a BLOB for SQLite storage. */
export function embeddingToBlob(vec: Float32Array): Buffer {
	return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Deserialize a stored BLOB back to a Float32Array. */
export function blobToEmbedding(blob: Buffer | Uint8Array | null): Float32Array | null {
	if (!blob || blob.length === 0) return null;
	return new Float32Array(
		(blob instanceof Buffer ? blob : Buffer.from(blob)).buffer,
		(blob instanceof Buffer ? blob : Buffer.from(blob)).byteOffset,
		Math.floor((blob instanceof Buffer ? blob : Buffer.from(blob)).byteLength / 4),
	);
}
