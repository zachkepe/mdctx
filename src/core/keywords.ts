const STOPWORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","as","at",
  "be","because","been","before","being","below","between","both","but","by",
  "can","cannot","could",
  "did","do","does","doing","down","during",
  "each","few","for","from","further",
  "had","has","have","having","he","her","here","hers","herself","him","himself","his","how",
  "i","if","in","into","is","it","its","itself",
  "let",
  "me","more","most","my","myself",
  "no","nor","not",
  "of","off","on","once","only","or","other","ought","our","ours","ourselves","out","over","own",
  "same","she","should","so","some","such",
  "than","that","the","their","theirs","them","themselves","then","there","these","they","this",
  "those","through","to","too",
  "under","until","up",
  "very",
  "was","we","were","what","when","where","which","while","who","whom","why","will","with","would",
  "you","your","yours","yourself","yourselves",
  "e.g","i.e","etc","via","using","use","used"
]);

const PHRASE_DELIMS = /[.,!?;:()\[\]{}"'`\n\r\t\-–—/\\|<>*_#>]+/;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9']/g, ""))
    .filter(Boolean);
}

function splitIntoPhrases(text: string): string[][] {
  const rawChunks = text.toLowerCase().split(PHRASE_DELIMS);
  const phrases: string[][] = [];

  for (const chunk of rawChunks) {
    const words = chunk.trim().split(/\s+/).filter(Boolean);
    let current: string[] = [];
    for (const w of words) {
      const clean = w.replace(/[^a-z0-9']/g, "");
      if (!clean) continue;
      if (STOPWORDS.has(clean) || /^\d+$/.test(clean)) {
        if (current.length) {
          phrases.push(current);
          current = [];
        }
      } else {
        current.push(clean);
      }
    }
    if (current.length) phrases.push(current);
  }

  return phrases;
}

const HEADING_LINE = /^#{1,6}\s+(.+)$/gm;
const EMPHASIS_SPAN = /(?:\*\*|__)(.+?)(?:\*\*|__)/g;
const HEADING_BOOST = 2;

/**
 * Words the author flagged as important by putting them in a heading or
 * bold/emphasis span. RAKE's degree/frequency score treats every word as
 * equally significant based only on how it co-occurs elsewhere in the
 * document, so a term that's genuinely important but only mentioned once
 * or twice in short phrases (a product name, a specific technology) can
 * lose to longer, more interconnected prose phrases even when the author
 * clearly called it out. This is a cheap, legitimate correction for that:
 * headings and bold text are an explicit signal from the author, not a
 * statistical inference, so words there get a fixed score multiplier.
 */
function extractBoostedWords(markdown: string): Set<string> {
  const boosted = new Set<string>();
  const collect = (text: string) => {
    for (const word of tokenize(text)) {
      if (!STOPWORDS.has(word)) boosted.add(word);
    }
  };

  for (const match of markdown.matchAll(HEADING_LINE)) collect(match[1]);
  for (const match of markdown.matchAll(EMPHASIS_SPAN)) collect(match[1]);

  return boosted;
}

const MIN_AUTO_KEYWORDS = 5;
const MAX_AUTO_KEYWORDS = 25;
const WORDS_PER_KEYWORD = 30;

/**
 * Pick a keyword budget sized to the document instead of a flat constant.
 * A 150-word doc and a 5,000-word doc both losing relevant terms to the
 * same fixed cutoff (or a short doc padded with low-signal keywords to
 * hit it) is the wrong tradeoff — this scales with word count instead,
 * clamped so tiny files don't get zero and huge files don't get hundreds.
 */
export function autoMaxKeywords(wordCount: number): number {
  return Math.min(MAX_AUTO_KEYWORDS, Math.max(MIN_AUTO_KEYWORDS, Math.round(wordCount / WORDS_PER_KEYWORD)));
}

/**
 * Score each candidate phrase by RAKE's degree/frequency heuristic and
 * return the top `maxKeywords` phrases, highest score first. If
 * `maxKeywords` is omitted, the budget is auto-sized to the document's
 * word count via `autoMaxKeywords`.
 */
export function extractKeywords(text: string, maxKeywords?: number): string[] {
  const phrases = splitIntoPhrases(text);
  if (phrases.length === 0) return [];

  const budget = maxKeywords ?? autoMaxKeywords(tokenize(text).length);
  const boostedWords = extractBoostedWords(text);

  const freq = new Map<string, number>();
  const degree = new Map<string, number>();

  for (const phrase of phrases) {
    const phraseDegree = phrase.length - 1;
    for (const word of phrase) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
      degree.set(word, (degree.get(word) ?? 0) + phraseDegree + 1);
    }
  }

  const wordScore = new Map<string, number>();
  for (const [word, f] of freq) {
    const base = (degree.get(word) ?? 0) / f;
    wordScore.set(word, boostedWords.has(word) ? base * HEADING_BOOST : base);
  }

  const phraseScores = new Map<string, number>();
  for (const phrase of phrases) {
    const key = phrase.join(" ");
    const score = phrase.reduce((sum, w) => sum + (wordScore.get(w) ?? 0), 0);
    const prior = phraseScores.get(key);
    if (prior === undefined || prior < score) {
      phraseScores.set(key, score);
    }
  }

  return [...phraseScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, budget)
    .map(([phrase]) => phrase);
}

/** Pull a title from YAML frontmatter, else the first H1, else a fallback. */
export function extractTitle(markdown: string, fallback: string): string {
  const frontmatterMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const titleLine = frontmatterMatch[1].match(/^title:\s*(.+)$/m);
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, "");
  }
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return fallback;
}
