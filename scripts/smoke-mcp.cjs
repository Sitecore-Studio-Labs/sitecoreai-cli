#!/usr/bin/env node

/**
 * Post-build smoke for `scai mcp serve`. Verifies that the built CLI
 * boots a minimum-viable MCP server end-to-end:
 *
 *   1. Boots `dist/esm/cli.js mcp serve --environment-name __test__` against
 *      a throwaway sitecoreai.cli.json in a temp directory.
 *   2. Sends a JSON-RPC `initialize` + `tools/list` + `resources/list`
 *      request on stdin.
 *   3. Asserts:
 *        a. A valid JSON-RPC response arrives within 5s.
 *        b. The `tools/list` result has >= 18 tools.
 *        c. The `resources/list` result has >= MIN_RESOURCE_COUNT
 *           resources (catches doc/code drift like the 11-vs-8 gap
 *           the 2026-05-21 audit found).
 *        d. stdout contains ONLY JSON-RPC frames — no banners, no log
 *           lines, no spinner artefacts. This is the regression guard
 *           for the stdout-discipline rule.
 *
 * Failures here mean a published scai release would break stdio MCP
 * clients. Wired into `pnpm smoke` after the build.
 */

"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const CLI = path.join("dist", "esm", "cli.js");
const TIMEOUT_MS = 5000;
const MIN_TOOL_COUNT = 18;
// docs/mcp.md's resource table is the source of truth — keep this in
// step. Lower bound, not equality, so adding a resource never breaks
// the smoke; removing one without updating docs will.
const MIN_RESOURCE_COUNT = 12;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-mcp-smoke-"));
const configPath = path.join(tempDir, "sitecoreai.cli.json");
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      modules: ["**/*.module.json"],
      defaultEnvProfile: "__test__",
      envProfiles: {
        __test__: {
          host: "https://example.invalid",
          authority: "https://auth.invalid",
          audience: "https://api.invalid",
          clientId: "stub",
          deployToken: "stub-deploy-token",
          organizationId: "org-stub",
          projectId: "proj-stub",
          environmentId: "env-stub",
        },
      },
      serialization: { excludedFields: [] },
    },
    null,
    2
  ),
  "utf8"
);

const child = spawn(
  process.execPath,
  [
    CLI,
    "mcp",
    "serve",
    "--environment-name",
    "__test__",
    "--config",
    tempDir,
    "--transport",
    "stdio",
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SITECOREAI_AUTO_WIZARD: "0",
      SITECOREAI_QUIET: "1",
      SITECOREAI_JSON: "1",
      SITECOREAI_MCP_SERVE: "1",
      SITECOREAI_NON_INTERACTIVE: "1",
    },
  }
);

let stdoutBuf = "";
let stderrBuf = "";
let timer = null;
let resolved = false;

const cleanup = (code, message) => {
  if (resolved) return;
  resolved = true;
  if (timer) clearTimeout(timer);
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (message) {
    process.stderr.write(`smoke-mcp: ${message}\n`);
  }
  process.exit(code);
};

timer = setTimeout(
  () => cleanup(1, `timed out after ${TIMEOUT_MS}ms (stderr=${stderrBuf.slice(0, 500)})`),
  TIMEOUT_MS
);

let initializedSent = false;
let toolsListId = null;
let resourcesListId = null;

const writeRequest = (request) => {
  const body = JSON.stringify(request);
  child.stdin.write(`${body}\n`);
};

const handleFrame = (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (err) {
    cleanup(1, `non-JSON line on stdout: ${line.slice(0, 200)} (${err.message})`);
    return;
  }
  if (frame.id === 1 && frame.result) {
    // initialize response — send initialized notification, then list tools.
    writeRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    toolsListId = 2;
    writeRequest({ jsonrpc: "2.0", id: toolsListId, method: "tools/list" });
    initializedSent = true;
    return;
  }
  if (frame.id === toolsListId) {
    if (!frame.result || !Array.isArray(frame.result.tools)) {
      cleanup(1, `tools/list response missing tools array: ${JSON.stringify(frame).slice(0, 300)}`);
      return;
    }
    const count = frame.result.tools.length;
    if (count < MIN_TOOL_COUNT) {
      cleanup(1, `tools/list returned ${count} tools, expected >= ${MIN_TOOL_COUNT}`);
      return;
    }
    // Chain into resources/list — same connection, same lifecycle.
    resourcesListId = 3;
    writeRequest({ jsonrpc: "2.0", id: resourcesListId, method: "resources/list" });
    return;
  }
  if (frame.id === resourcesListId) {
    if (!frame.result || !Array.isArray(frame.result.resources)) {
      cleanup(
        1,
        `resources/list response missing resources array: ${JSON.stringify(frame).slice(0, 300)}`
      );
      return;
    }
    const resourceCount = frame.result.resources.length;
    if (resourceCount < MIN_RESOURCE_COUNT) {
      cleanup(
        1,
        `resources/list returned ${resourceCount} resources, expected >= ${MIN_RESOURCE_COUNT} (docs/mcp.md is the source of truth — keep MIN_RESOURCE_COUNT in step).`
      );
      return;
    }
    process.stdout.write(
      `smoke-mcp: ok (tools >= ${MIN_TOOL_COUNT}, resources >= ${MIN_RESOURCE_COUNT})\n`
    );
    cleanup(0);
  }
};

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  let newlineIndex;
  while ((newlineIndex = stdoutBuf.indexOf("\n")) !== -1) {
    const line = stdoutBuf.slice(0, newlineIndex).trim();
    stdoutBuf = stdoutBuf.slice(newlineIndex + 1);
    if (line.length === 0) continue;
    if (!line.startsWith("{")) {
      cleanup(1, `non-JSON-RPC content on stdout: ${line.slice(0, 200)}`);
      return;
    }
    handleFrame(line);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderrBuf += chunk;
});

child.on("error", (err) => cleanup(1, `child process error: ${err.message}`));
child.on("exit", (code, signal) => {
  if (!resolved) {
    cleanup(
      1,
      `child exited prematurely (code=${code} signal=${signal}); stderr=${stderrBuf.slice(0, 500)}`
    );
  }
});

// Send initialize first.
writeRequest({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scai-smoke-mcp", version: "0.0.0" },
  },
});

// Keep the event loop alive while the IO promises resolve.
void initializedSent;
