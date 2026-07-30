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
  // undefined here means "auto-size per file" (see extractKeywords), not
  // "use some indexer-level default" — leave it unset unless the caller
  // pinned a fixed budget.
  const maxKeywords = options.maxKeywords;
  const ignore = options.ignore ?? DEFAULT_IGNORE;

  // Stored relative to the index file's own directory so the committed
  // JSON is identical across machines and CI runners, not tied to one
  // filesystem's absolute layout.
  const storedRoot = path.relative(path.dirname(indexPath), root).split(path.sep).join("/") || ".";

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

  const entriesChanged =
    !existing ||
    Object.keys(entries).length !== Object.keys(existing.entries ?? {}).length ||
    Object.entries(entries).some(([relPath, entry]) => existing?.entries?.[relPath]?.hash !== entry.hash);

  const index: ContextIndex = {
    version: INDEX_VERSION,
    root: storedRoot,
    // Only bump generatedAt when content actually changed, so a rebuild
    // over an unchanged doc set produces a byte-identical file. That's
    // what lets the pre-commit hook and CI staleness check use a plain
    // file diff instead of a content-aware comparison.
    generatedAt: entriesChanged ? new Date().toISOString() : existing!.generatedAt,
    entries,
  };

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

function isWellFormedIndex(value: unknown): value is ContextIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ContextIndex>;
  return (
    candidate.version === INDEX_VERSION &&
    typeof candidate.root === "string" &&
    typeof candidate.entries === "object" &&
    candidate.entries !== null
  );
}

export interface LoadIndexOptions {
  /**
   * Directory to rebuild from if the index is missing, unparseable, or was
   * written by an incompatible version. Defaults to the index file's own
   * directory, which is the common case (index lives alongside the docs
   * it covers, e.g. `docs/context-index.json` indexing `docs/`).
   */
  root?: string;
  maxKeywords?: number;
  ignore?: string[];
}

/**
 * Load the index, auto-healing by rebuilding from scratch if the file is
 * missing, corrupt, or was written by an incompatible index version. This
 * is what keeps `mdctx search` and the MCP server working without a manual
 * `mdctx build` after someone deletes the file or an old version drifts.
 */
export async function loadIndex(
  indexPath: string,
  options: LoadIndexOptions = {}
): Promise<ContextIndex> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch {
    parsed = null;
  }

  if (isWellFormedIndex(parsed)) {
    return parsed;
  }

  const root = options.root ?? path.dirname(indexPath);
  return buildIndex({
    root,
    indexPath,
    maxKeywords: options.maxKeywords,
    ignore: options.ignore,
  });
}
