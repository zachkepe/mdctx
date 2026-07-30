/**
 * Git hook and CI workflow templates written by `mdctx init`. Kept as
 * plain string constants (rather than separate files copied at build
 * time) so the compiled dist/ output is self-contained with no extra
 * build step beyond tsc.
 */

// Resolves to a full shell command (not just a path) since the pinned
// fallback is a plain .js file that has to be run through `node`, while a
// node_modules/.bin or PATH hit is an executable shim that runs directly.
const MDCTX_BIN_RESOLUTION = (pinnedBinPath: string) => `if [ -f "${pinnedBinPath}" ]; then
  MDCTX_CMD="node ${pinnedBinPath}"
elif [ -x "node_modules/.bin/mdctx" ]; then
  MDCTX_CMD="node_modules/.bin/mdctx"
elif command -v mdctx > /dev/null 2>&1; then
  MDCTX_CMD="mdctx"
else
  echo "mdctx: could not find the mdctx CLI (checked ${pinnedBinPath}, node_modules/.bin/mdctx, PATH)." >&2
  exit 1
fi`;

/**
 * `pinnedBinPath` is the absolute path to the mdctx CLI that ran `init`,
 * captured at install time via process.argv[1]. Pinning it means the hook
 * keeps working even when mdctx isn't a project devDependency and isn't on
 * PATH in whatever shell git invokes hooks from (a common source of "it
 * works in my terminal but not from git" bugs).
 */
export function preCommitHook(pinnedBinPath: string): string {
  return `#!/bin/sh
# Installed by \`mdctx init\`. Rebuilds the context index before every commit
# and stages it, so context-index.json never falls out of sync with the
# docs it describes.
set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

if [ ! -f ".mdctx.json" ]; then
  exit 0
fi

DOCS_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).docsDir)")
INDEX_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).indexPath)")

${MDCTX_BIN_RESOLUTION(pinnedBinPath)}

$MDCTX_CMD build "$DOCS_DIR" --output "$INDEX_PATH" > /dev/null

git add "$INDEX_PATH"
`;
}

export function postMergeHook(pinnedBinPath: string): string {
  return `#!/bin/sh
# Installed by \`mdctx init\`. Rebuilds the context index after a pull/merge
# brings in doc changes, so local search results stay current without a
# manual \`mdctx build\`. Advisory only, never blocks the merge.

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
cd "$REPO_ROOT" || exit 0

if [ ! -f ".mdctx.json" ]; then
  exit 0
fi

DOCS_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).docsDir)") || exit 0
INDEX_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).indexPath)") || exit 0

${MDCTX_BIN_RESOLUTION(pinnedBinPath)}

$MDCTX_CMD build "$DOCS_DIR" --output "$INDEX_PATH" > /dev/null 2>&1 || exit 0

if ! git diff --quiet -- "$INDEX_PATH"; then
  echo "mdctx: context index was rebuilt after merge and now differs from the committed version." >&2
  echo "mdctx: run 'git add $INDEX_PATH && git commit' to record the update." >&2
fi
`;
}

export function postCheckoutHook(pinnedBinPath: string): string {
  return `#!/bin/sh
# Installed by \`mdctx init\`. Rebuilds the context index after switching
# branches, so local search results reflect the docs on the branch you
# just checked out. Advisory only, never blocks the checkout.

# $3 is 1 for a branch checkout, 0 for a file checkout (git passes this to
# post-checkout hooks). Skip file-level checkouts, only act on branch switches.
if [ "$3" != "1" ]; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
cd "$REPO_ROOT" || exit 0

if [ ! -f ".mdctx.json" ]; then
  exit 0
fi

DOCS_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).docsDir)") || exit 0
INDEX_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).indexPath)") || exit 0

${MDCTX_BIN_RESOLUTION(pinnedBinPath)}

$MDCTX_CMD build "$DOCS_DIR" --output "$INDEX_PATH" > /dev/null 2>&1 || exit 0

if ! git diff --quiet -- "$INDEX_PATH"; then
  echo "mdctx: context index was rebuilt after checkout and now differs from the committed version." >&2
  echo "mdctx: run 'git add $INDEX_PATH && git commit' to record the update." >&2
fi
`;
}

export const GITHUB_WORKFLOW = `name: mdctx index check

on:
  push:
  pull_request:

jobs:
  verify-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install mdctx
        run: npm install -g mdctx

      - name: Rebuild context index
        run: |
          DOCS_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).docsDir)")
          INDEX_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).indexPath)")
          mdctx build "$DOCS_DIR" --output "$INDEX_PATH"

      - name: Fail if the committed index is stale
        run: |
          INDEX_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.mdctx.json','utf8')).indexPath)")
          if ! git diff --quiet -- "$INDEX_PATH"; then
            echo "::error::$INDEX_PATH is out of date. Run 'mdctx build' locally and commit the result."
            git diff -- "$INDEX_PATH"
            exit 1
          fi
`;
