#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildIndex, loadIndex, DEFAULT_INDEX_FILENAME } from "./core/indexer.js";
import { search } from "./core/search.js";
import { findGitRoot, writeConfig, defaultConfig } from "./core/config.js";
import {
  preCommitHook,
  postMergeHook,
  postCheckoutHook,
  GITHUB_WORKFLOW,
} from "./core/templates.js";

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
  .option(
    "-k, --max-keywords <n>",
    "Max keywords per file. Omit to auto-size per file based on its word count (5-25)"
  )
  .action(async (dir: string, opts: { output?: string; maxKeywords?: string }) => {
    const root = path.resolve(dir);
    const indexPath = opts.output
      ? path.resolve(opts.output)
      : path.join(root, DEFAULT_INDEX_FILENAME);
    const index = await buildIndex({
      root,
      indexPath,
      maxKeywords: opts.maxKeywords !== undefined ? Number(opts.maxKeywords) : undefined,
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

const MDCTX_HOOK_MARKER = "Installed by `mdctx init`";

program
  .command("init")
  .description(
    "Wire up automatic index updates: git hooks that rebuild on commit/merge/checkout, " +
      "plus a GitHub Actions check that fails a PR if the index is stale"
  )
  .argument("[dir]", "Directory containing the markdown docs to index", ".")
  .option("--force", "Overwrite existing hooks even if they weren't installed by mdctx")
  .action(async (dir: string, opts: { force?: boolean }) => {
    const gitRoot = await findGitRoot(process.cwd());
    if (!gitRoot) {
      console.error("mdctx init must be run inside a git repository (no .git found).");
      process.exitCode = 1;
      return;
    }

    const docsAbsPath = path.resolve(dir);
    const docsDir = path.relative(gitRoot, docsAbsPath).split(path.sep).join("/") || ".";
    const indexPath = `${docsDir === "." ? "" : docsDir + "/"}${DEFAULT_INDEX_FILENAME}`;

    await writeConfig(gitRoot, defaultConfig(docsDir, indexPath));
    console.log(`Wrote ${path.join(gitRoot, ".mdctx.json")}`);

    const hooksDir = path.join(gitRoot, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });

    // Pin the exact CLI that ran `init` so hooks work even when mdctx isn't
    // on PATH in whatever minimal shell git invokes hooks from.
    const pinnedBinPath = path.resolve(process.argv[1]);
    const hooks: Record<string, string> = {
      "pre-commit": preCommitHook(pinnedBinPath),
      "post-merge": postMergeHook(pinnedBinPath),
      "post-checkout": postCheckoutHook(pinnedBinPath),
    };

    for (const [name, contents] of Object.entries(hooks)) {
      const hookPath = path.join(hooksDir, name);
      let existing: string | null = null;
      try {
        existing = await fs.readFile(hookPath, "utf8");
      } catch {
        existing = null;
      }

      if (existing && !existing.includes(MDCTX_HOOK_MARKER) && !opts.force) {
        console.warn(
          `Skipped ${name}: an existing hook is already installed. Re-run with --force to overwrite it.`
        );
        continue;
      }

      await fs.writeFile(hookPath, contents, { mode: 0o755 });
      await fs.chmod(hookPath, 0o755);
      console.log(`Wrote ${hookPath}`);
    }

    const workflowDir = path.join(gitRoot, ".github", "workflows");
    await fs.mkdir(workflowDir, { recursive: true });
    const workflowPath = path.join(workflowDir, "mdctx-index.yml");
    await fs.writeFile(workflowPath, GITHUB_WORKFLOW, "utf8");
    console.log(`Wrote ${workflowPath}`);

    const index = await buildIndex({
      root: docsAbsPath,
      indexPath: path.join(gitRoot, indexPath),
    });
    console.log(`Indexed ${Object.keys(index.entries).length} file(s) -> ${indexPath}`);
    console.log(
      "\nDone. Commits, merges, and branch checkouts in this repo will now keep " +
        `${indexPath} up to date automatically.`
    );
  });

program.parseAsync(process.argv);
