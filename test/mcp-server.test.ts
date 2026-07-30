import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled test files live under dist-test/test/, but the server under
// test is the actual production build in dist/, not a copy under dist-test.
const SERVER_PATH = path.join(__dirname, "..", "..", "dist", "mcp-server.js");

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mdctx-mcp-test-"));
}

interface RpcClient {
  proc: ChildProcessWithoutNullStreams;
  request(method: string, params?: unknown): Promise<any>;
  close(): void;
}

function startServer(root: string): RpcClient {
  const proc = spawn("node", [SERVER_PATH], {
    env: { ...process.env, MDCTX_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const pending = new Map<number, (value: any) => void>();

  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    }
  });

  let nextId = 1;
  return {
    proc,
    request(method: string, params?: unknown) {
      const id = nextId++;
      const payload = { jsonrpc: "2.0", id, method, params: params ?? {} };
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timed out waiting for response to ${method}`));
        }, 10000);
        pending.set(id, (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        });
        proc.stdin.write(JSON.stringify(payload) + "\n");
      });
    },
    close() {
      proc.kill();
    },
  };
}

test("mcp server initializes and lists the three expected tools", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "doc.md"), "# Doc\ndeployment notes");
    const client = startServer(dir);
    try {
      const initResp = await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mdctx-test", version: "0.0.0" },
      });
      assert.ok(initResp.result, `expected initialize result, got ${JSON.stringify(initResp)}`);

      client.proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
      );

      const toolsResp = await client.request("tools/list", {});
      const names = toolsResp.result.tools.map((t: any) => t.name).sort();
      assert.deepEqual(names, ["list_context", "refresh_index", "search_context"]);
    } finally {
      client.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mcp server refresh_index then search_context round-trips a real query", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(
      path.join(dir, "auth-flow.md"),
      "# Authentication Flow\n\nUsers authenticate via OAuth2. Access token and refresh token " +
        "are used for login session management."
    );
    await fs.writeFile(path.join(dir, "deployment.md"), "# Deployment\ncontainer image release");

    const client = startServer(dir);
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mdctx-test", version: "0.0.0" },
      });
      client.proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
      );

      const refreshResp = await client.request("tools/call", {
        name: "refresh_index",
        arguments: {},
      });
      assert.ok(!refreshResp.result.isError, JSON.stringify(refreshResp));
      assert.match(refreshResp.result.content[0].text, /Indexed 2 file\(s\)/);

      const searchResp = await client.request("tools/call", {
        name: "search_context",
        arguments: { query: "login token refresh", limit: 5 },
      });
      const results = JSON.parse(searchResp.result.content[0].text);
      assert.ok(results.length > 0);
      assert.equal(results[0].path, "auth-flow.md");

      const listResp = await client.request("tools/call", {
        name: "list_context",
        arguments: {},
      });
      const entries = JSON.parse(listResp.result.content[0].text);
      assert.equal(entries.length, 2);
    } finally {
      client.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mcp server search_context reports an error before an index exists", async () => {
  const dir = await makeTempDir();
  try {
    const client = startServer(dir);
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mdctx-test", version: "0.0.0" },
      });
      client.proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
      );

      const searchResp = await client.request("tools/call", {
        name: "search_context",
        arguments: { query: "anything" },
      });
      assert.equal(searchResp.result.isError, true);
    } finally {
      client.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mcp server never writes non-protocol output to stdout", async () => {
  const dir = await makeTempDir();
  try {
    await fs.writeFile(path.join(dir, "doc.md"), "# Doc\nnotes");
    const client = startServer(dir);
    let sawInvalidLine = false;
    client.proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          JSON.parse(trimmed);
        } catch {
          sawInvalidLine = true;
        }
      }
    });
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mdctx-test", version: "0.0.0" },
      });
      await client.request("tools/call", { name: "refresh_index", arguments: {} });
      assert.equal(sawInvalidLine, false, "stdout contained a non-JSON line");
    } finally {
      client.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
