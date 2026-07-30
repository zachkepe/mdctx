import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, extractKeywords, extractTitle, autoMaxKeywords } from "../src/core/keywords.js";

test("tokenize lowercases and strips punctuation", () => {
  assert.deepEqual(tokenize("Hello, World!"), ["hello", "world"]);
});

test("tokenize collapses whitespace runs", () => {
  assert.deepEqual(tokenize("a    b\tc\n\nd"), ["a", "b", "c", "d"]);
});

test("tokenize drops tokens that are pure punctuation", () => {
  assert.deepEqual(tokenize("hello -- world ... !!!"), ["hello", "world"]);
});

test("tokenize keeps apostrophes and digits inside words", () => {
  assert.deepEqual(tokenize("don't use v2 builds"), ["don't", "use", "v2", "builds"]);
});

test("extractKeywords returns [] for empty input", () => {
  assert.deepEqual(extractKeywords(""), []);
});

test("extractKeywords returns [] for stopword-only input", () => {
  assert.deepEqual(extractKeywords("the a an and or but"), []);
});

test("extractKeywords respects maxKeywords", () => {
  const text =
    "The access token is issued by the identity provider. The refresh " +
    "token renews the session. The container image is built in CI. " +
    "The deploy pipeline pushes to the registry. The secret manager " +
    "injects credentials at release time.";
  const keywords = extractKeywords(text, 3);
  assert.equal(keywords.length, 3);
});

test("extractKeywords surfaces a multi-word domain phrase intact", () => {
  const text =
    "The access token expires after fifteen minutes. The refresh token " +
    "is used to obtain a new access token without forcing login again.";
  const keywords = extractKeywords(text, 10);
  assert.ok(
    keywords.some((k) => k.includes("access token") || k.includes("refresh token")),
    `expected an access/refresh token phrase, got ${JSON.stringify(keywords)}`
  );
});

test("extractKeywords never returns a phrase built only of stopwords", () => {
  const text = "This is a document about the deployment of things and stuff.";
  const keywords = extractKeywords(text, 10);
  for (const k of keywords) {
    const words = k.split(" ");
    assert.ok(words.length > 0);
  }
});

test("extractKeywords is deterministic across repeated calls", () => {
  const text = "container image registry deploy pipeline secret manager";
  const first = extractKeywords(text, 5);
  const second = extractKeywords(text, 5);
  assert.deepEqual(first, second);
});

test("autoMaxKeywords clamps to the minimum for very short documents", () => {
  assert.equal(autoMaxKeywords(0), 5);
  assert.equal(autoMaxKeywords(20), 5);
});

test("autoMaxKeywords clamps to the maximum for very long documents", () => {
  assert.equal(autoMaxKeywords(5000), 25);
});

test("autoMaxKeywords scales roughly linearly in the middle of the range", () => {
  // ~30 words per keyword, so 600 words should land near 20.
  assert.equal(autoMaxKeywords(600), 20);
});

test("extractKeywords auto-sizes the keyword budget when maxKeywords is omitted", () => {
  const shortText = "Deployment notes about container image release.";
  const shortKeywords = extractKeywords(shortText);
  assert.ok(shortKeywords.length <= autoMaxKeywords(tokenize(shortText).length));

  const longText = Array.from(
    { length: 40 },
    (_, i) => `Section ${i} discusses topic number ${i} in detail with unique terminology ${i}.`
  ).join(" ");
  const longKeywords = extractKeywords(longText);
  assert.ok(longKeywords.length > shortKeywords.length);
});

test("extractKeywords with an explicit maxKeywords ignores document length entirely", () => {
  const longText = Array.from(
    { length: 40 },
    (_, i) => `Section ${i} discusses topic number ${i} in detail with unique terminology ${i}.`
  ).join(" ");
  const keywords = extractKeywords(longText, 2);
  assert.equal(keywords.length, 2);
});

test("extractTitle reads title from YAML frontmatter", () => {
  const md = `---\ntitle: Authentication Flow\n---\n\n# Something Else\n`;
  assert.equal(extractTitle(md, "fallback"), "Authentication Flow");
});

test("extractTitle strips quotes from frontmatter title", () => {
  const md = `---\ntitle: "Quoted Title"\n---\n\nbody\n`;
  assert.equal(extractTitle(md, "fallback"), "Quoted Title");
});

test("extractTitle falls back to first H1 when no frontmatter", () => {
  const md = `# Deployment\n\nBody text.\n`;
  assert.equal(extractTitle(md, "fallback"), "Deployment");
});

test("extractTitle falls back to the provided default when nothing matches", () => {
  const md = `just a plain paragraph, no heading\n`;
  assert.equal(extractTitle(md, "my-fallback"), "my-fallback");
});

test("extractTitle prefers frontmatter over an H1 that also exists", () => {
  const md = `---\ntitle: From Frontmatter\n---\n\n# From Heading\n`;
  assert.equal(extractTitle(md, "fallback"), "From Frontmatter");
});
