// GM-1 live probe: exercises the REAL @xenova/transformers embedding path
// (the impure part that unit tests deliberately avoid — model download +
// actual inference). Run as a fresh `npx tsx` process so it require()s the
// repo code from disk, bypassing any parent-pi module cache (pi-roles
// independent-process probe methodology). Proves the embedder loads, embeds,
// and produces sensible cosine similarity (semantically-similar text closer
// than dissimilar text) before hybrid search relies on it in prod.
//
//   npx tsx scripts/probe-gm1-embeddings.ts

import { getEmbedder } from '../src/memory/embeddings';
import { cosineSimilarity } from '../src/memory/hybrid';

async function main(): Promise<void> {
	console.log('[probe-gm1] loading @xenova/transformers model (first run downloads ~23MB)...');
	const embed = await getEmbedder();
	console.log('[probe-gm1] model loaded; embedding sample texts...');

	const a = await embed('the cat sat on the mat');
	const b = await embed('a feline rested on the rug');
	const c = await embed('typescript compiler strict mode settings');

	const simAB = cosineSimilarity(a, b);
	const simAC = cosineSimilarity(a, c);
	console.log('[probe-gm1] sim("cat sat on mat", "feline rested on rug") =', simAB.toFixed(4));
	console.log('[probe-gm1] sim("cat sat on mat", "typescript compiler")  =', simAC.toFixed(4));

	if (a.length < 10) throw new Error(`embedding too short (${a.length}); model may not have loaded`);
	if (!(simAB > simAC)) {
		throw new Error(`FAIL: expected sim(cat,feline) > sim(cat,typescript); got ${simAB} vs ${simAC}`);
	}
	console.log('[probe-gm1] PASS: real @xenova embeddings load + cosine ranks semantic proximity correctly.');
}

main().catch((e) => {
	console.error('[probe-gm1] PROBE ERROR:', e);
	process.exit(1);
});
