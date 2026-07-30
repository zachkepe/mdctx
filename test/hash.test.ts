import { test } from "node:test";
import assert from "node:assert/strict";
import { hashContent } from "../src/core/hash.js";

test("hashContent is deterministic for identical input", () => {
  const a = hashContent("hello world");
  const b = hashContent("hello world");
  assert.equal(a, b);
});

test("hashContent differs for different input", () => {
  const a = hashContent("hello world");
  const b = hashContent("hello there");
  assert.notEqual(a, b);
});

test("hashContent is prefixed with the algorithm name", () => {
  assert.match(hashContent("x"), /^sha1:[0-9a-f]{40}$/);
});

test("hashContent handles empty string", () => {
  assert.match(hashContent(""), /^sha1:[0-9a-f]{40}$/);
});
