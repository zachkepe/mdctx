#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { buildIndex, loadIndex, DEFAULT_INDEX_FILENAME } from "./core/indexer.js";
import { search } from "./core/search.js";

const ROOT = process.env.MDCTX_ROOT ? path.resolve(process.env.MDCTX_ROOT) : process.cwd();
const INDEX_PATH = process.env.MDCTX_INDEX
  ? path.resolve(process.env.MDCTX_INDEX)
  : path.join(ROOT, DEFAULT_INDEX_FILENAME);

const server = new McpServer({ name: "mdctx", version: "0.1.0" });

server.tool(
  "search_context",
  "Search the markdown context index for files relevant to a query. Returns ranked file paths so you can read only what's relevant instead of the whole workspace.",
  {
    query: z.string().describe("Natural-language or keyword search query"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 5)"),
  },
  async ({ query, limit }: { query: string; limit?: number }) => {
    try {
      const index = await loadIndex(INDEX_PATH);
      const results = search(index, query, limit ?? 5);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `No index found at ${INDEX_PATH}. Call refresh_index first. (${(err as Error).message})`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "refresh_index",
  "Rebuild the context index by scanning for changed markdown files. Unchanged files are skipped (incremental).",
  {},
  async () => {
    const index = await buildIndex({ root: ROOT, indexPath: INDEX_PATH });
    return {
      content: [
        { type: "text", text: `Indexed ${Object.keys(index.entries).length} file(s) at ${INDEX_PATH}` },
      ],
    };
  }
);

server.tool(
  "list_context",
  "List every file currently in the context index with its title and keywords.",
  {},
  async () => {
    const index = await loadIndex(INDEX_PATH);
    const entries = Object.values(index.entries).map((e) => ({
      path: e.path,
      title: e.title,
      keywords: e.keywords,
    }));
    return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mdctx MCP server running on stdio");
