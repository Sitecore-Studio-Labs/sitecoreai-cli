/**
 * Architecture guardrail: every `run*` task exported from a domain's
 * `tasks/` tree must be reachable from at least one user-facing surface
 * (CLI commands or MCP tools). Without this, library work can stall in
 * a "compiles but no one can call it" state — the exact drift that
 * caused `runCleanupSiteResidue` and `runCleanupWorkflowAdvance` to
 * sit unrouted in `src/mcp/tools/cleanup.ts` for a while before being
 * spotted.
 *
 * What counts as "reachable":
 *   - The runner's symbol name appears in any `src/commands/**.ts`
 *     file (the CLI surface), OR
 *   - The symbol name appears in any `src/mcp/tools/**.ts` file (the
 *     MCP surface).
 *
 * The check is intentionally lax — a single textual reference is
 * enough. This catches the "completely orphaned" case. The narrower
 * "imported but not in the routing table" case is the job of per-tool
 * parity tests (see `tests/unit/mcp/tools/cleanup.test.ts`).
 *
 * Exclusions: list runners here only if they're intentionally
 * library-only (e.g. consumed by another reachable `run*` and never
 * exposed). Keep the list small — every entry weakens the guardrail.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO_ROOT, "src");

const TASK_ROOTS = [
  "publishing/tasks",
  "deploy/tasks",
  "recipe/tasks",
  "serialization/tasks",
  "brand/tasks",
  "hygiene/tasks",
  "workflow/tasks",
  "webhooks/tasks",
];

const SURFACES = ["commands", "mcp/tools"];

/**
 * Runners that are intentionally not surfaced. Add entries only with a
 * comment that names the upstream caller so reviewers can verify the
 * exclusion is still valid.
 */
const ALLOWED_ORPHANS: ReadonlySet<string> = new Set([
  // Internal helper of `runPublishUnpublish` (src/publishing/tasks/unpublish.ts).
  // Split out into unpublish-delete.ts for file-size reasons; the parent
  // runner is the one wired to the CLI and MCP surfaces.
  "runDeleteUnpublish",
]);

const walkTs = async (dir: string): Promise<string[]> => {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkTs(full)));
    } else if (e.isFile() && e.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
};

const collectRunners = async (taskRoot: string): Promise<string[]> => {
  const files = await walkTs(path.join(SRC, taskRoot));
  const names = new Set<string>();
  const pattern = /^export\s+(?:const|async function|function)\s+(run[A-Z][A-Za-z0-9_]+)/gm;
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
};

const collectSurfaceText = async (): Promise<string> => {
  let combined = "";
  for (const root of SURFACES) {
    for (const file of await walkTs(path.join(SRC, root))) {
      combined += `\n// ${file}\n${await fs.readFile(file, "utf8")}`;
    }
  }
  return combined;
};

describe("architecture: runner reachability", () => {
  it("every `run*` task export is referenced by a CLI command or MCP tool", async () => {
    const surfaceText = await collectSurfaceText();
    const orphans: Array<{ runner: string; taskRoot: string }> = [];

    for (const root of TASK_ROOTS) {
      const runners = await collectRunners(root);
      for (const runner of runners) {
        if (ALLOWED_ORPHANS.has(runner)) continue;
        const re = new RegExp(`\\b${runner}\\b`);
        if (!re.test(surfaceText)) {
          orphans.push({ runner, taskRoot: root });
        }
      }
    }

    if (orphans.length > 0) {
      const lines = orphans
        .map(({ runner, taskRoot }) => `  ${runner} (in src/${taskRoot})`)
        .join("\n");
      throw new Error(
        `Found ${orphans.length} orphaned runner(s) — exported but not referenced by any CLI command or MCP tool:\n${lines}\n\n` +
          `Either wire each into src/commands/<group>/ (CLI) or src/mcp/tools/<tool>.ts (MCP), or add it to ALLOWED_ORPHANS in this test with a comment naming the upstream caller.`
      );
    }
    expect(orphans).toEqual([]);
  });

  it("registers at least 100 runners (sanity check on the scan)", async () => {
    let total = 0;
    for (const root of TASK_ROOTS) {
      total += (await collectRunners(root)).length;
    }
    // 147 today; a sudden drop means the scan regex broke or a domain moved.
    expect(total).toBeGreaterThan(100);
  });
});
