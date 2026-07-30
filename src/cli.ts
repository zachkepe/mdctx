#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { buildIndex, loadIndex, DEFAULT_INDEX_FILENAME } from "./core/indexer.js";
import { search } from "./core/search.js";

const program = new Command();

program
  .name("mdctx")
  .description("Fast keyword-based context index for markdown files")
  .version("0.1.0");

program
  .command("build")
  .description("Index all markdown files under a directory (incremental)")
  .argument("[dir]", "Directory to index", ".")
  .option("-o, --output <path>", "Path to write the index JSON")
  .option("-k, --max-keywords <n>", "Max keywords per file", "10")
  .action(async (dir: string, opts: { output?: string; maxKeywords: string }) => {
    const root = path.resolve(dir);
    const indexPath = opts.output
      ? path.resolve(opts.output)
      : path.join(root, DEFAULT_INDEX_FILENAME);
    const index = await buildIndex({
      root,
      indexPath,
      maxKeywords: Number(opts.maxKeywords),
    });
    console.log(`Indexed ${Object.keys(index.entries).length} file(s) -> ${indexPath}`);
  });

program
  .command("search")
  .description("Search the context index")
  .argument("<query>", "Search query")
  .option("-i, --index <path>", "Path to the index JSON", `./${DEFAULT_INDEX_FILENAME}`)
  .option("-n, --limit <n>", "Max results", "5")
  .option("--json", "Output raw JSON")
  .action(async (query: string, opts: { index: string; limit: string; json?: boolean }) => {
    const indexPath = path.resolve(opts.index);
    const index = await loadIndex(indexPath);
    const results = search(index, query, Number(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    if (results.length === 0) {
      console.log("No matches.");
      return;
    }
    for (const r of results) {
      console.log(`${r.score.toFixed(2)}  ${r.path}  (${r.title})`);
    }
  });

program.parseAsync(process.argv);
