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
// Compiled test files live under dist-test/test/, but the CLI under test
// is the actual production build in dist/, not a copy under dist-test.
const CLI_PATH = path.join(__dirname, "..", "..", "dist", "cli.js");

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mdctx-cli-test-"));
}

test("cli build writes an index file and reports the count", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "one.md"), "# One\ndeployment pipeline notes");
    await fs.writeFile(path.join(dir, "two.md"), "# Two\nauthentication token notes");

    const { stdout } = await execFileAsync("node", [CLI_PATH, "build", dir]);
    assert.match(stdout, /Indexed 2 file\(s\)/);

    const indexPath = path.join(dir, "context-index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(Object.keys(parsed.entries).length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli search returns the more relevant doc first in plain output", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(
      path.join(dir, "auth-flow.md"),
      "---\ntitle: Authentication Flow\n---\n\n# Authentication Flow\n\n" +
        "Users authenticate via OAuth2. The access token expires after 15 minutes; " +
        "the refresh token is used to silently obtain a new login token without " +
        "forcing the user to log in again."
    );
    await fs.writeFile(
      path.join(dir, "deployment.md"),
      "# Deployment\n\nThis project deploys via a container image built in CI."
    );

    await execFileAsync("node", [CLI_PATH, "build", dir]);

    const indexPath = path.join(dir, "context-index.json");
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "search",
      "login token refresh",
      "--index",
      indexPath,
    ]);

    const firstResultLine = stdout.trim().split("\n")[0];
    assert.match(firstResultLine, /auth-flow\.md/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli search --json emits parseable JSON with expected shape", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "deployment.md"), "# Deployment\ncontainer image release");
    await execFileAsync("node", [CLI_PATH, "build", dir]);

    const indexPath = path.join(dir, "context-index.json");
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "search",
      "deployment",
      "--index",
      indexPath,
      "--json",
    ]);

    const results = JSON.parse(stdout);
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    assert.ok("path" in results[0]);
    assert.ok("score" in results[0]);
    assert.ok("matchedKeywords" in results[0]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli search prints 'No matches.' when nothing matches", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "deployment.md"), "# Deployment\ncontainer image release");
    await execFileAsync("node", [CLI_PATH, "build", dir]);

    const indexPath = path.join(dir, "context-index.json");
    const { stdout } = await execFileAsync("node", [
      CLI_PATH,
      "search",
      "zzzznonexistentqueryterm",
      "--index",
      indexPath,
    ]);

    assert.match(stdout, /No matches\./);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli build --output writes the index to a custom path", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "one.md"), "# One\nsome notes");
    const customPath = path.join(dir, "custom-index.json");

    await execFileAsync("node", [CLI_PATH, "build", dir, "--output", customPath]);

    const raw = await fs.readFile(customPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(Object.keys(parsed.entries).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli build is incremental across two runs (second run reuses hashes)", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "one.md"), "# One\nsome notes about deployment");
    const indexPath = path.join(dir, "context-index.json");

    await execFileAsync("node", [CLI_PATH, "build", dir, "--output", indexPath]);
    const firstRaw = await fs.readFile(indexPath, "utf8");
    const first = JSON.parse(firstRaw);

    await new Promise((r) => setTimeout(r, 5));
    await execFileAsync("node", [CLI_PATH, "build", dir, "--output", indexPath]);
    const secondRaw = await fs.readFile(indexPath, "utf8");
    const second = JSON.parse(secondRaw);

    assert.equal(first.entries["one.md"].hash, second.entries["one.md"].hash);
    assert.equal(first.entries["one.md"].updatedAt, second.entries["one.md"].updatedAt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("cli --version prints the package version", async () => {
  const { stdout } = await execFileAsync("node", [CLI_PATH, "--version"]);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});
