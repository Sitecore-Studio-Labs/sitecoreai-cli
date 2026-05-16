/**
 * `scai mcp serve --transport http` — Streamable HTTP transport.
 *
 * Boots the transport on an OS-assigned port and exercises it two ways:
 *   - the MCP SDK client over Streamable HTTP — the same round-trip a
 *     browser-hosted MCP client makes — for the handshake + tool list;
 *   - raw `http.request` for the CORS / Host / routing edge cases,
 *     because `fetch` forbids overriding the `Host` header.
 */

import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpTransport, type HttpTransportHandle } from "../../../src/mcp/http";
import { buildScaiMcpRegistry } from "../../../src/mcp/build-registry";
import type { McpContextProvider } from "../../../src/mcp/auth";

// `initialize` and `tools/list` never touch the bound environment, so a
// throwing provider proves the HTTP path completes the handshake
// without any keychain access.
const unusedContext: McpContextProvider = async () => {
  throw new Error("getContext must not be called for the handshake / listTools");
};

const startTestServer = (): Promise<HttpTransportHandle> =>
  startHttpTransport({
    getContext: unusedContext,
    registry: buildScaiMcpRegistry(),
    host: "127.0.0.1",
    port: 0,
  });

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

const rawRequest = (options: {
  port: number;
  method: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        path: options.path ?? "/mcp",
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        res.resume(); // drain the body — only status + headers matter here
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });

describe("scai mcp serve — http transport", () => {
  let handle: HttpTransportHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("completes the MCP handshake and lists the tool surface over HTTP", async () => {
    handle = await startTestServer();
    const client = new Client({ name: "scai-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("recipe_push");
      expect(tools.length).toBeGreaterThanOrEqual(20);
    } finally {
      await client.close();
    }
  });

  it("answers a CORS preflight with permissive headers", async () => {
    handle = await startTestServer();
    const res = await rawRequest({
      port: handle.port,
      method: "OPTIONS",
      headers: { Host: `127.0.0.1:${handle.port}`, Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("rejects a forged Host header (DNS-rebinding defense)", async () => {
    handle = await startTestServer();
    const res = await rawRequest({
      port: handle.port,
      method: "POST",
      headers: { Host: "evil.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(403);
  });

  it("405s a GET on /mcp (stateless: no standalone stream)", async () => {
    handle = await startTestServer();
    const res = await rawRequest({
      port: handle.port,
      method: "GET",
      headers: { Host: `127.0.0.1:${handle.port}` },
    });
    expect(res.status).toBe(405);
  });

  it("404s a path other than /mcp", async () => {
    handle = await startTestServer();
    const res = await rawRequest({
      port: handle.port,
      method: "GET",
      path: "/nope",
      headers: { Host: `127.0.0.1:${handle.port}` },
    });
    expect(res.status).toBe(404);
  });
});
