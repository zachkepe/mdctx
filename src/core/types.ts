export interface IndexEntry {
  path: string;
  title: string;
  keywords: string[];
  hash: string;
  updatedAt: string;
}

export interface ContextIndex {
  version: number;
  root: string;
  generatedAt: string;
  entries: Record<string, IndexEntry>;
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  matchedKeywords: string[];
}
