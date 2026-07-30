import { test } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/core/search.js";
import type { ContextIndex } from "../src/core/types.js";

function makeIndex(entries: ContextIndex["entries"]): ContextIndex {
  return {
    version: 1,
    root: "/tmp/fake",
    generatedAt: new Date().toISOString(),
    entries,
  };
}

test("search returns [] when the index has no entries", () => {
  const index = makeIndex({});
  assert.deepEqual(search(index, "anything"), []);
});

test("search returns [] when no terms match", () => {
  const index = makeIndex({
    "a.md": {
      path: "a.md",
      title: "Deployment",
      keywords: ["container image", "secret manager"],
      hash: "sha1:x",
      updatedAt: new Date().toISOString(),
    },
  });
  assert.deepEqual(search(index, "quantum entanglement"), []);
});

test("search ranks the more relevant document first", () => {
  const index = makeIndex({
    "auth-flow.md": {
      path: "auth-flow.md",
      title: "Authentication Flow",
      keywords: ["access token", "refresh token", "login", "session cookie"],
      hash: "sha1:a",
      updatedAt: new Date().toISOString(),
    },
    "deployment.md": {
      path: "deployment.md",
      title: "Deployment",
      keywords: ["container image", "secret manager", "release"],
      hash: "sha1:b",
      updatedAt: new Date().toISOString(),
    },
  });

  const results = search(index, "login token refresh", 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].path, "auth-flow.md");
});

test("search respects the limit parameter", () => {
  const entries: ContextIndex["entries"] = {};
  for (let i = 0; i < 10; i++) {
    entries[`doc-${i}.md`] = {
      path: `doc-${i}.md`,
      title: `Doc about deployment ${i}`,
      keywords: ["deployment", "release"],
      hash: `sha1:${i}`,
      updatedAt: new Date().toISOString(),
    };
  }
  const index = makeIndex(entries);
  const results = search(index, "deployment", 3);
  assert.equal(results.length, 3);
});

test("search results are sorted by descending score", () => {
  const index = makeIndex({
    "weak.md": {
      path: "weak.md",
      title: "Random",
      keywords: ["deployment"],
      hash: "sha1:a",
      updatedAt: new Date().toISOString(),
    },
    "strong.md": {
      path: "strong.md",
      title: "Deployment deployment deployment",
      keywords: ["deployment", "deployment", "deployment"],
      hash: "sha1:b",
      updatedAt: new Date().toISOString(),
    },
  });
  const results = search(index, "deployment", 5);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
});

test("search reports which query terms matched", () => {
  const index = makeIndex({
    "auth-flow.md": {
      path: "auth-flow.md",
      title: "Authentication Flow",
      keywords: ["access token", "refresh token"],
      hash: "sha1:a",
      updatedAt: new Date().toISOString(),
    },
  });
  const results = search(index, "token nonexistentword", 5);
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedKeywords.includes("token"));
  assert.ok(!results[0].matchedKeywords.includes("nonexistentword"));
});
