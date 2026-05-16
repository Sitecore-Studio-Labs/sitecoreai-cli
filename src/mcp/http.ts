/**
 * `scai mcp serve --transport http` — Streamable HTTP transport.
 *
 * Why a second transport file? `server.ts` owns the stdio path, where
 * one long-lived `McpServer` is bound to the process for its whole
 * lifetime. HTTP is request-scoped: the MCP Streamable HTTP spec wants
 * a fresh server + transport per POST so concurrent clients can't
 * collide on JSON-RPC request ids.
 *
 * We run **stateless** (no `Mcp-Session-Id`). scai's dispatch rwlock
 * already serializes writes process-wide, so there is no per-session
 * state worth keeping alive between requests, and progress
 * notifications still ride the per-request response stream.
 *
 * Security: binds to loopback by default and validates the `Host`
 * header against the bound address (DNS-rebinding defense — a
 * malicious web page cannot point its own hostname at this loopback
 * port). CORS is permissive on `Origin` so a browser-hosted MCP client
 * can connect; the real boundary is the loopback bind + Host check +
 * the per-call `allowWrite` gate every write tool already enforces.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type McpServerOptions } from "./server";

/** The single MCP endpoint path. Everything else 404s. */
const MCP_PATH = "/mcp";

export interface HttpTransportOptions extends McpServerOptions {
  /** Bind address. Callers default this to loopback. */
  host: string;
  /** Listener port. `0` lets the OS assign one (used by tests). */
  port: number;
}

export interface HttpTransportHandle {
  /** Full MCP endpoint URL, e.g. `http://127.0.0.1:3399/mcp`. */
  url: string;
  /** Actually-bound port — resolves `port: 0` to the OS-assigned port. */
  port: number;
  /** Stop the listener and release the port. */
  close: () => Promise<void>;
}

interface RequestContext {
  getContext: McpServerOptions["getContext"];
  registry: McpServerOptions["registry"];
  /** Host-header values accepted by the rebinding check. */
  allowedHosts: Set<string>;
}

const writeJsonRpcError = (
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
};

/**
 * Permissive CORS so a browser-hosted MCP client can connect from any
 * local dev origin. Origin filtering is deliberately *not* the security
 * boundary here (see the file header) — it is reflected, not enforced.
 */
const applyCorsHeaders = (req: IncomingMessage, res: ServerResponse): void => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Max-Age", "86400");
};

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext
): Promise<void> => {
  applyCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // DNS-rebinding defense: the Host header must match the bound address.
  const hostHeader = req.headers.host;
  if (!hostHeader || !ctx.allowedHosts.has(hostHeader)) {
    writeJsonRpcError(
      res,
      403,
      -32600,
      `Forbidden: Host header '${hostHeader ?? ""}' is not allowed.`
    );
    return;
  }

  const pathname = new URL(req.url ?? "/", `http://${hostHeader}`).pathname;
  if (pathname !== MCP_PATH) {
    writeJsonRpcError(res, 404, -32600, `Not found. The MCP endpoint is ${MCP_PATH}.`);
    return;
  }

  // Stateless mode: GET (standalone SSE stream) and DELETE (session
  // teardown) have no meaning without sessions.
  if (req.method !== "POST") {
    writeJsonRpcError(
      res,
      405,
      -32600,
      `Method ${req.method ?? "?"} not allowed. POST JSON-RPC to ${MCP_PATH}.`
    );
    return;
  }

  // A fresh server + transport per request so concurrent clients can't
  // collide on JSON-RPC request ids. `buildMcpServer` is a cheap
  // synchronous factory; the shared `getContext` provider stays
  // memoized across all of them.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildMcpServer({ getContext: ctx.getContext, registry: ctx.registry });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, error instanceof Error ? error.message : String(error));
    }
  }
};

/**
 * Start the Streamable HTTP listener. Resolves once the socket is bound
 * (or rejects on a bind error, e.g. `EADDRINUSE`). The returned handle
 * keeps the process alive via the open server; `close()` releases it.
 */
export const startHttpTransport = (options: HttpTransportOptions): Promise<HttpTransportHandle> => {
  const { host, port, getContext, registry } = options;
  const allowedHosts = new Set<string>();

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res, { getContext, registry, allowedHosts });
  });

  return new Promise<HttpTransportHandle>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.off("error", onError);
      const boundPort = (httpServer.address() as AddressInfo).port;
      // Populate the rebinding allowlist with the real port — the
      // loopback aliases plus whatever `--host` resolved to.
      for (const alias of [host, "localhost", "127.0.0.1", "[::1]"]) {
        allowedHosts.add(`${alias}:${boundPort}`);
      }
      resolve({
        url: `http://${host}:${boundPort}${MCP_PATH}`,
        port: boundPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            httpServer.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
};
