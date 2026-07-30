import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildIndex, loadIndex } from "../src/core/indexer.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mdctx-test-"));
}

test("buildIndex indexes only markdown files, ignoring other extensions", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "a.md"), "# Hello\nsome content here");
    await fs.writeFile(path.join(dir, "b.mdx"), "# World\nother content");
    await fs.writeFile(path.join(dir, "c.txt"), "not markdown");
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath });
    assert.deepEqual(Object.keys(index.entries).sort(), ["a.md", "b.mdx"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex skips ignored directories like node_modules and .git", async () => {
  const dir = await makeTempDir();
  try {
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "node_modules", "dep.md"), "# Dep");
    await fs.mkdir(path.join(dir, ".git"));
    await fs.writeFile(path.join(dir, ".git", "note.md"), "# Note");
    await fs.writeFile(path.join(dir, "real.md"), "# Real doc");
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath });
    assert.deepEqual(Object.keys(index.entries), ["real.md"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex skips common vendored/virtualenv directories by default", async () => {
  const dir = await makeTempDir();
  try {
    for (const vendored of ["venv", ".venv", "__pycache__", "vendor", "coverage"]) {
      await fs.mkdir(path.join(dir, vendored));
      await fs.writeFile(path.join(dir, vendored, "noise.md"), "# Noise");
    }
    await fs.writeFile(path.join(dir, "real.md"), "# Real doc");
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath });
    assert.deepEqual(Object.keys(index.entries), ["real.md"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex recurses into nested subdirectories", async () => {
  const dir = await makeTempDir();
  try {
    await fs.mkdir(path.join(dir, "nested", "deeper"), { recursive: true });
    await fs.writeFile(path.join(dir, "nested", "deeper", "doc.md"), "# Deep doc");
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath });
    assert.deepEqual(Object.keys(index.entries), ["nested/deeper/doc.md"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex writes a JSON file that round-trips through loadIndex", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "a.md"), "# Hello\nsome content");
    const indexPath = path.join(dir, "context-index.json");

    await buildIndex({ root: dir, indexPath });
    const loaded = await loadIndex(indexPath);
    assert.equal(loaded.version, 1);
    assert.equal(Object.keys(loaded.entries).length, 1);
    assert.equal(loaded.entries["a.md"].title, "Hello");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex is incremental: unchanged files keep their original updatedAt/hash", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "a.md");
    await fs.writeFile(filePath, "# Hello\nsome content here");
    const indexPath = path.join(dir, "context-index.json");

    const first = await buildIndex({ root: dir, indexPath });
    const firstEntry = first.entries["a.md"];

    // small delay so a changed updatedAt would be detectably different
    await new Promise((r) => setTimeout(r, 5));

    const second = await buildIndex({ root: dir, indexPath });
    const secondEntry = second.entries["a.md"];

    assert.equal(secondEntry.hash, firstEntry.hash);
    assert.equal(secondEntry.updatedAt, firstEntry.updatedAt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex re-processes a file after its content changes", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "a.md");
    await fs.writeFile(filePath, "# Hello\noriginal content");
    const indexPath = path.join(dir, "context-index.json");

    const first = await buildIndex({ root: dir, indexPath });
    const firstHash = first.entries["a.md"].hash;

    await fs.writeFile(filePath, "# Hello\ncompletely different content now");
    const second = await buildIndex({ root: dir, indexPath });
    const secondHash = second.entries["a.md"].hash;

    assert.notEqual(firstHash, secondHash);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex drops entries for files that were deleted since the last run", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "gone.md");
    await fs.writeFile(filePath, "# Gone\ntemporary content");
    const indexPath = path.join(dir, "context-index.json");

    await buildIndex({ root: dir, indexPath });
    await fs.rm(filePath);
    const second = await buildIndex({ root: dir, indexPath });

    assert.deepEqual(Object.keys(second.entries), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex uses forward slashes in paths regardless of platform separators", async () => {
  const dir = await makeTempDir();
  try {
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "sub", "doc.md"), "# Doc");
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath });
    const keys = Object.keys(index.entries);
    assert.ok(keys.includes("sub/doc.md"));
    assert.ok(!keys.some((k) => k.includes("\\")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildIndex respects maxKeywords option", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = path.join(dir, "a.md");
    await fs.writeFile(
      filePath,
      "access token refresh token identity provider session cookie container image deploy pipeline"
    );
    const indexPath = path.join(dir, "context-index.json");

    const index = await buildIndex({ root: dir, indexPath, maxKeywords: 2 });
    assert.ok(index.entries["a.md"].keywords.length <= 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
