import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "..", "..", "dist", "cli.js");

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mdctx-init-test-"));
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd });
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test User"]);
}

test("mdctx init fails clearly outside a git repository", async () => {
  const dir = await makeTempDir();
  try {
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\nnotes");

    await assert.rejects(
      execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir }),
      /git repository/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mdctx init writes config, hooks, workflow, and an initial index", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\nauthentication notes");

    await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });

    const config = JSON.parse(await fs.readFile(path.join(dir, ".mdctx.json"), "utf8"));
    assert.equal(config.docsDir, "docs");
    assert.equal(config.indexPath, "docs/context-index.json");

    for (const hook of ["pre-commit", "post-merge", "post-checkout"]) {
      const hookPath = path.join(dir, ".git", "hooks", hook);
      const stat = await fs.stat(hookPath);
      assert.ok(stat.mode & 0o111, `${hook} should be executable`);
      const contents = await fs.readFile(hookPath, "utf8");
      assert.match(contents, /Installed by `mdctx init`/);
    }

    const workflow = await fs.readFile(
      path.join(dir, ".github", "workflows", "mdctx-index.yml"),
      "utf8"
    );
    assert.match(workflow, /mdctx index check/);

    const index = JSON.parse(await fs.readFile(path.join(dir, "docs", "context-index.json"), "utf8"));
    assert.equal(Object.keys(index.entries).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mdctx init does not overwrite a pre-existing foreign pre-commit hook without --force", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\nnotes");

    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho custom hook\n", { mode: 0o755 });

    const { stderr } = await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });
    assert.match(stderr, /Skipped pre-commit/);

    const stillThere = await fs.readFile(hookPath, "utf8");
    assert.match(stillThere, /custom hook/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mdctx init --force overwrites a pre-existing foreign hook", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\nnotes");

    const hookPath = path.join(dir, ".git", "hooks", "pre-commit");
    await fs.writeFile(hookPath, "#!/bin/sh\necho custom hook\n", { mode: 0o755 });

    await execFileAsync("node", [CLI_PATH, "init", "./docs", "--force"], { cwd: dir });

    const replaced = await fs.readFile(hookPath, "utf8");
    assert.match(replaced, /Installed by `mdctx init`/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("pre-commit hook rebuilds and stages the index automatically when docs change", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\noriginal content");

    await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "initial commit"]);

    // Edit the doc and stage only the doc, not the index, then commit.
    // The pre-commit hook should rebuild and stage the index for us.
    await fs.writeFile(
      path.join(dir, "docs", "a.md"),
      "# A\nupdated content about database migrations"
    );
    await git(dir, ["add", "docs/a.md"]);
    const { stdout } = await git(dir, ["commit", "-m", "update doc"]);
    assert.match(stdout, /2 files changed/);

    const index = JSON.parse(
      await fs.readFile(path.join(dir, "docs", "context-index.json"), "utf8")
    );
    assert.ok(index.entries["a.md"].keywords.some((k: string) => k.includes("database migrations")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("pre-commit hook does not touch the index when it is already up to date", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\noriginal content");

    await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "initial commit"]);

    await fs.writeFile(path.join(dir, "unrelated.txt"), "hello");
    await git(dir, ["add", "unrelated.txt"]);
    const { stdout } = await git(dir, ["commit", "-m", "unrelated change"]);
    assert.doesNotMatch(stdout, /context-index\.json/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("post-checkout hook keeps the index consistent with the checked-out branch", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\nmaster content about auth");

    await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "initial commit"]);

    await git(dir, ["checkout", "-b", "feature"]);
    await fs.writeFile(
      path.join(dir, "docs", "a.md"),
      "# A\nfeature branch content about kubernetes"
    );
    await git(dir, ["add", "docs/a.md"]);
    await git(dir, ["commit", "-m", "feature edit"]);

    await git(dir, ["checkout", "master"]);

    const index = JSON.parse(
      await fs.readFile(path.join(dir, "docs", "context-index.json"), "utf8")
    );
    const keywordText = index.entries["a.md"].keywords.join(" ");
    assert.match(keywordText, /auth/);
    assert.doesNotMatch(keywordText, /kubernetes/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a hook-bypassed commit produces an index that a fresh rebuild detects as stale", async () => {
  const dir = await makeTempDir();
  try {
    await initRepo(dir);
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\noriginal content");

    await execFileAsync("node", [CLI_PATH, "init", "./docs"], { cwd: dir });
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "initial commit"]);

    // Simulate a commit that skipped the hook (--no-verify), so docs
    // changed but the committed index did not.
    await fs.writeFile(path.join(dir, "docs", "a.md"), "# A\ndrifted content about redis");
    await git(dir, ["add", "docs/a.md"]);
    await git(dir, ["commit", "--no-verify", "-m", "bypass hook"]);

    const beforeRebuild = await fs.readFile(
      path.join(dir, "docs", "context-index.json"),
      "utf8"
    );

    // This is what the CI workflow does: rebuild and check for drift.
    await execFileAsync("node", [CLI_PATH, "build", "./docs", "--output", "docs/context-index.json"], {
      cwd: dir,
    });
    const afterRebuild = await fs.readFile(
      path.join(dir, "docs", "context-index.json"),
      "utf8"
    );

    assert.notEqual(beforeRebuild, afterRebuild);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
