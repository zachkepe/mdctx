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

/**
 * Score each candidate phrase by RAKE's degree/frequency heuristic and
 * return the top `maxKeywords` phrases, highest score first.
 */
export function extractKeywords(text: string, maxKeywords = 10): string[] {
  const phrases = splitIntoPhrases(text);
  if (phrases.length === 0) return [];

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
    wordScore.set(word, (degree.get(word) ?? 0) / f);
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
    .slice(0, maxKeywords)
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
