# mdctx

A zero-ML-dependency keyword index for markdown context files. Built for
large workspaces where dumping every doc into an LLM's context window
wastes tokens — `mdctx` indexes your markdown once, then answers "which
files are relevant to X" in milliseconds, from a flat JSON file you can
commit and diff like code.

## Why this exists

There are already several MCP servers that index markdown notes with
hybrid keyword+semantic search (qmd, dotmd, foam-notes-mcp, and others).
`mdctx` is deliberately narrower than those:

- **No SQLite, no vector DB, no embedding model to download.** The index
  is a single flat JSON file you can read, diff, and review in a PR.
- **Keyword-only by design**, using RAKE-style extraction and BM25
  ranking — fully deterministic, fully offline, no cost per index update.
- **Cross-model on purpose.** Ships as both a CLI (usable from any script
  or agent that can shell out) and an MCP server (usable by Claude,
  ChatGPT, Cursor, and anything else that speaks MCP).

If you need semantic/fuzzy matching across large free-text notes, one of
the heavier tools above is likely a better fit. If you have a workspace
of structured docs and want a fast, transparent, git-friendly index,
that's what this is for.

## Install

```bash
npm install -g mdctx
```

## CLI usage

```bash
# Index every .md/.mdx file under a directory (incremental — only
# changed files are re-processed)
mdctx build ./docs

# Search the index
mdctx search "auth flow"
mdctx search "auth flow" --json --limit 3
```

## MCP usage

Add to your MCP client config (e.g. Claude Desktop's
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mdctx": {
      "command": "mdctx-mcp",
      "env": {
        "MDCTX_ROOT": "/absolute/path/to/your/docs"
      }
    }
  }
}
```

This exposes three tools: `search_context`, `refresh_index`, and
`list_context`. `search_context` auto-heals: if the index is missing,
corrupt, or was written by an older mdctx version, it gets rebuilt
transparently on the next call rather than erroring out.

## Keeping the index up to date automatically

Run this once per repo:

```bash
mdctx init ./docs
```

This wires up everything needed so you never have to remember to run
`mdctx build` by hand:

- **`.mdctx.json`** — records which directory holds your docs and where
  the index lives, so the hooks and CI job below don't need arguments.
- **A pre-commit hook** — rebuilds the index and stages it before every
  commit, so `context-index.json` always reflects what you're about to
  commit. If nothing changed, the rebuild is a no-op and nothing gets
  added to the commit.
- **post-merge / post-checkout hooks** — rebuild the index after a pull
  or a branch switch, so local search results match whatever's on disk.
  These are advisory: if the rebuild fails for any reason they print a
  warning to stderr rather than blocking the merge or checkout.
- **`.github/workflows/mdctx-index.yml`** — a CI check that rebuilds the
  index on every push/PR and fails the build if it doesn't match what's
  committed. This is the backstop for commits made with `--no-verify`,
  from a machine that never ran `mdctx init`, or by a bot.

Re-running `mdctx init` is safe. It won't overwrite a hook it didn't
install unless you pass `--force`, so it won't clobber pre-existing
hooks from another tool.

If you'd rather not touch git hooks, the CI workflow alone is enough to
catch staleness; just don't run `mdctx init` and use `mdctx build`
manually or in whatever pipeline already touches your docs.

## How it works

1. `mdctx build` walks the target directory for `.md`/`.mdx` files,
   hashes each one, and skips any file whose hash hasn't changed since
   the last run.
2. For new/changed files, it extracts a title (from frontmatter or the
   first heading) and a set of keywords using a RAKE-style scoring
   algorithm — no LLM call, no network request.
3. Everything is written to `context-index.json` — one JSON object per
   file, human-readable and git-diffable. A rebuild that finds no content
   changes writes back the exact same bytes (the `root` path is stored
   relative to the index file, and the `generatedAt` timestamp only moves
   when something actually changed), so running `mdctx build` repeatedly
   never produces spurious diffs.
4. `mdctx search` loads that JSON, builds a BM25 index in memory over
   each file's title+keywords, and returns ranked results.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
