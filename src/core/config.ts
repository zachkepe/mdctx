import { promises as fs } from "node:fs";
import path from "node:path";

export const CONFIG_FILENAME = ".mdctx.json";

export interface MdctxConfig {
  /** Directory containing the markdown docs, relative to the repo root. */
  docsDir: string;
  /** Path to the index file, relative to the repo root. */
  indexPath: string;
}

export function defaultConfig(docsDir: string, indexPath: string): MdctxConfig {
  return { docsDir, indexPath };
}

export async function writeConfig(repoRoot: string, config: MdctxConfig): Promise<string> {
  const configPath = path.join(repoRoot, CONFIG_FILENAME);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}

export async function readConfig(repoRoot: string): Promise<MdctxConfig | null> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, CONFIG_FILENAME), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.docsDir === "string" && typeof parsed.indexPath === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Walk upward from `startDir` to find the nearest directory containing `.git`. */
export async function findGitRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  while (true) {
    try {
      const stat = await fs.stat(path.join(dir, ".git"));
      if (stat.isDirectory() || stat.isFile()) return dir;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
