import { promises as fs } from "node:fs";
import path from "node:path";
import { extractKeywords, extractTitle } from "./keywords.js";
import { hashContent } from "./hash.js";
import type { ContextIndex, IndexEntry } from "./types.js";

const INDEX_VERSION = 1;
export const DEFAULT_INDEX_FILENAME = "context-index.json";
const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".tox",
  "vendor",
  "coverage",
  ".cache",
];

export interface BuildOptions {
  root: string;
  indexPath?: string;
  maxKeywords?: number;
  ignore?: string[];
}

async function walkMarkdownFiles(dir: string, ignore: string[]): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignore.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkMarkdownFiles(fullPath, ignore)));
    } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Build (or incrementally update) the context index. Files whose content
 * hash is unchanged since the last run are reused as-is — keywords are
 * only recomputed for new or modified files.
 */
export async function buildIndex(options: BuildOptions): Promise<ContextIndex> {
  const root = path.resolve(options.root);
  const indexPath = options.indexPath ?? path.join(root, DEFAULT_INDEX_FILENAME);
  const maxKeywords = options.maxKeywords ?? 10;
  const ignore = options.ignore ?? DEFAULT_IGNORE;

  let existing: ContextIndex | null = null;
  try {
    existing = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch {
    existing = null;
  }

  const files = await walkMarkdownFiles(root, ignore);
  const entries: Record<string, IndexEntry> = {};

  for (const filePath of files) {
    const relPath = path.relative(root, filePath).split(path.sep).join("/");
    const content = await fs.readFile(filePath, "utf8");
    const hash = hashContent(content);

    const previous = existing?.entries?.[relPath];
    if (previous && previous.hash === hash) {
      entries[relPath] = previous;
      continue;
    }

    entries[relPath] = {
      path: relPath,
      title: extractTitle(content, path.basename(filePath, path.extname(filePath))),
      keywords: extractKeywords(content, maxKeywords),
      hash,
      updatedAt: new Date().toISOString(),
    };
  }

  const index: ContextIndex = {
    version: INDEX_VERSION,
    root,
    generatedAt: new Date().toISOString(),
    entries,
  };

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

export async function loadIndex(indexPath: string): Promise<ContextIndex> {
  return JSON.parse(await fs.readFile(indexPath, "utf8"));
}
