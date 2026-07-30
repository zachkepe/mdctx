import { tokenize } from "./keywords.js";
import type { ContextIndex, SearchResult } from "./types.js";

const K1 = 1.5;
const B = 0.75;

interface DocStats {
  path: string;
  title: string;
  termFreq: Map<string, number>;
  length: number;
}

export function search(index: ContextIndex, query: string, limit = 5): SearchResult[] {
  const entries = Object.values(index.entries);
  if (entries.length === 0) return [];

  const docs: DocStats[] = entries.map((entry) => {
    const tokens = tokenize([entry.title, ...entry.keywords].join(" "));
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    return { path: entry.path, title: entry.title, termFreq, length: tokens.length || 1 };
  });

  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const N = docs.length;
  const queryTerms = [...new Set(tokenize(query))];

  const results: SearchResult[] = [];
  for (const doc of docs) {
    let score = 0;
    const matched: string[] = [];
    for (const term of queryTerms) {
      const df = docFreq.get(term) ?? 0;
      const tf = doc.termFreq.get(term) ?? 0;
      if (df === 0 || tf === 0) continue;
      matched.push(term);
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + (B * doc.length) / avgLength);
      score += idf * (numerator / denominator);
    }
    if (score > 0) {
      results.push({ path: doc.path, title: doc.title, score, matchedKeywords: matched });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
