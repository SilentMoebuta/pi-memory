let jieba: any = null;
try {
  jieba = require('nodejieba');
} catch {}

/** CJK character range for detection */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/** ASCII tokenization: split on word boundaries, lowercase */
function simpleTokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (CJK_RE.test(text[i])) {
      // CJK bigram fallback (when jieba unavailable)
      if (i + 1 < text.length && CJK_RE.test(text[i + 1])) {
        tokens.push(text[i] + text[i + 1]);
      }
      tokens.push(text[i]);
      i++;
    } else if (/[a-zA-Z0-9]/.test(text[i])) {
      let word = text[i];
      while (i + 1 < text.length && /[a-zA-Z0-9]/.test(text[i + 1])) {
        word += text[++i];
      }
      tokens.push(word.toLowerCase());
      i++;
    } else {
      i++;
    }
  }
  return tokens;
}

export function tokenize(text: string): string[] {
  if (!text) return [];

  // If jieba is not available, use pure-JS fallback
  if (!jieba) {
    return simpleTokenize(text);
  }

  // Hybrid: segment by language, apply jieba to CJK, simple to ASCII
  const tokens: string[] = [];
  let segment = '';
  let segmentIsCJK = false;

  const flush = () => {
    if (segment.length === 0) return;
    if (segmentIsCJK) {
      try {
        const cut = jieba.cut(segment);
        for (const t of cut) {
          const trimmed = t.trim();
          if (trimmed.length > 0) tokens.push(trimmed);
        }
        // Augment with bigrams for better character-level recall
        for (let j = 0; j < segment.length - 1; j++) {
          if (CJK_RE.test(segment[j]) && CJK_RE.test(segment[j + 1])) {
            tokens.push(segment[j] + segment[j + 1]);
          }
        }
      } catch {
        tokens.push(...simpleTokenize(segment));
      }
    } else {
      tokens.push(...simpleTokenize(segment));
    }
    segment = '';
  };

  for (let i = 0; i < text.length; i++) {
    const charIsCJK = CJK_RE.test(text[i]);
    if (segment.length > 0 && charIsCJK !== segmentIsCJK) {
      flush();
    }
    segmentIsCJK = charIsCJK;
    segment += text[i];
  }
  flush();

  return tokens;
}

export interface BM25Result {
  index: number;
  score: number;
}

export class BM25Index {
  private documents: string[][] = [];
  private docLengths: number[] = [];
  private avgDL: number = 1;
  private idf: Map<string, number> = new Map();
  private k1: number;
  private b: number;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  addDocuments(docs: string[]): void {
    for (const doc of docs) {
      const tokens = tokenize(doc);
      this.documents.push(tokens);
      this.docLengths.push(tokens.length);
    }

    this.avgDL =
      this.docLengths.reduce((a, b) => a + b, 0) /
      Math.max(1, this.docLengths.length);

    const N = this.documents.length;
    this.idf.clear();
    for (const docTokens of this.documents) {
      const seen = new Set(docTokens);
      for (const token of seen) {
        this.idf.set(token, (this.idf.get(token) || 0) + 1);
      }
    }
    for (const [token, df] of this.idf) {
      this.idf.set(
        token,
        Math.log(1 + (N - df + 0.5) / (df + 0.5)),
      );
    }
  }

  search(query: string): BM25Result[] {
    const queryTokens = tokenize(query);
    const results: BM25Result[] = [];

    for (let i = 0; i < this.documents.length; i++) {
      let score = 0;
      const docTokens = this.documents[i];
      const dl = this.docLengths[i];

      for (const qt of queryTokens) {
        const idfVal = this.idf.get(qt) || 0;
        const tf = docTokens.filter((t) => t === qt).length;
        if (tf === 0) continue;
        score +=
          (idfVal * (tf * (this.k1 + 1))) /
          (tf + this.k1 * (1 - this.b + (this.b * dl) / this.avgDL));
      }

      if (score > 0) {
        results.push({ index: i, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
