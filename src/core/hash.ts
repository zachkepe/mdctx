import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  return "sha1:" + createHash("sha1").update(content).digest("hex");
}
