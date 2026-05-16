/**
 * Architecture guardrail: for verb-discriminated MCP tools, every CLI
 * group must map to at least one MCP verb. This is the narrower
 * companion to `runner-reachability.test.ts` — that test catches "task
 * exists but nothing imports it"; this one catches "imported by an MCP
 * tool but missing from the routing table" (the original
 * site-residue / workflow-advance drift).
 *
 * Each entry binds a CLI factory + MCP tool name + per-rename map.
 * Add a row when a new verb-shaped MCP tool ships. The cleanup test in
 * `tests/unit/mcp/tools/cleanup.test.ts` already covers cleanup —
 * preserving that one keeps the failure local to the tool's own test
 * file. Tools added here are the ones without a dedicated test yet.
 */

import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { z, ZodEnum } from "zod";

interface ParityRow {
  /** Friendly label for failure messages. */
  domain: string;
  /** CLI command factory — returns the Commander group whose subcommands are the CLI verbs. */
  cliFactory: () => Promise<Command>;
  /** MCP tool name (must be verb-discriminated). */
  mcpTool: string;
  /**
   * Optional rename map: CLI subcommand name → MCP verb name.
   * Only needed when the names don't match by equality or the
   * `startsWith(group + "-")` prefix rule. Each entry is a debt note
   * — naming-alignment is preferred over a permanent rename row.
   */
  renames?: Record<string, string>;
}

const PARITY_ROWS: ParityRow[] = [
  {
    domain: "workflow → workflow_lifecycle (mutating verbs)",
    cliFactory: async () => {
      const { createWorkflowCommand } = await import("../../../src/commands/workflow");
      return createWorkflowCommand();
    },
    mcpTool: "workflow_lifecycle",
    // CLI subcommands the lifecycle tool handles. The inspect tool
    // covers the others (list/inspect/status/assigned/list-defs/list-commands);
    // that pairing is tested below.
    renames: {
      apply: "apply-workflow",
    },
  },
  {
    domain: "workflow → workflow_inspect (read verbs)",
    cliFactory: async () => {
      const { createWorkflowCommand } = await import("../../../src/commands/workflow");
      return createWorkflowCommand();
    },
    mcpTool: "workflow_inspect",
  },
  {
    domain: "webhook → webhook_manage (mutating verbs)",
    cliFactory: async () => {
      const { createWebhookCommand } = await import("../../../src/commands/webhook");
      return createWebhookCommand();
    },
    mcpTool: "webhook_manage",
  },
  {
    domain: "webhook → webhook_inspect (read verbs)",
    cliFactory: async () => {
      const { createWebhookCommand } = await import("../../../src/commands/webhook");
      return createWebhookCommand();
    },
    mcpTool: "webhook_inspect",
    // CLI `inspect` reads one handler's detail; MCP collapses it into
    // the read tool as verb='get'. CLI `list` maps to verb='list'.
    renames: {
      inspect: "get",
    },
  },
];

const getMcpVerbs = async (toolName: string): Promise<string[]> => {
  const { buildScaiMcpRegistry } = await import("../../../src/mcp/build-registry");
  const reg = buildScaiMcpRegistry();
  const tool = reg.getTool(toolName);
  if (!tool) throw new Error(`MCP tool '${toolName}' not registered.`);
  const verbField = (tool.inputSchema as { verb?: z.ZodType }).verb;
  if (!verbField) throw new Error(`MCP tool '${toolName}' has no \`verb\` field.`);
  const options = (verbField as unknown as ZodEnum<[string, ...string[]]>).options;
  return [...options];
};

/**
 * Check whether the CLI group name has any matching verb in the MCP
 * tool's enum, applying:
 *   - direct equality (group === verb)
 *   - prefix rule (verb starts with `group-`)
 *   - explicit rename map
 *
 * If none match, the group is treated as "covered by the *other* MCP
 * tool in the pair" (e.g. workflow's read verbs aren't expected to
 * appear in workflow_lifecycle). The test asserts only that the UNION
 * across both tools in a domain covers every CLI group — see the
 * second test below.
 */
const matchesVerb = (
  group: string,
  verbs: readonly string[],
  renames?: Record<string, string>
): boolean => {
  if (renames?.[group] && verbs.includes(renames[group])) return true;
  return verbs.some((v) => v === group || v.startsWith(`${group}-`));
};

describe("architecture: CLI/MCP verb parity", () => {
  it("every CLI group is covered by at least one MCP verb across the domain's tools", async () => {
    // Group rows by CLI factory (each domain may have a read tool +
    // a write tool; the union of their verbs is what we check).
    const byDomain = new Map<string, { rows: ParityRow[]; verbs: Set<string>; groups: string[] }>();
    for (const row of PARITY_ROWS) {
      const cmd = await row.cliFactory();
      const key = cmd.name();
      const verbs = await getMcpVerbs(row.mcpTool);
      const existing = byDomain.get(key);
      if (existing) {
        for (const v of verbs) existing.verbs.add(v);
        existing.rows.push(row);
      } else {
        byDomain.set(key, {
          rows: [row],
          verbs: new Set(verbs),
          groups: cmd.commands.map((c) => c.name()),
        });
      }
    }

    const gaps: Array<{ domain: string; group: string }> = [];
    for (const [domain, { rows, verbs, groups }] of byDomain) {
      const verbList = [...verbs];
      // Merge rename maps across the rows for this domain so a rename
      // declared on the read tool applies when matching against the
      // union of verbs.
      const renames = rows.reduce<Record<string, string>>(
        (acc, r) => ({ ...acc, ...(r.renames ?? {}) }),
        {}
      );
      for (const group of groups) {
        if (!matchesVerb(group, verbList, renames)) {
          gaps.push({ domain, group });
        }
      }
    }

    if (gaps.length > 0) {
      const lines = gaps
        .map(({ domain, group }) => `  CLI '${domain} ${group}' → no matching MCP verb`)
        .join("\n");
      throw new Error(
        `Found ${gaps.length} CLI/MCP parity gap(s):\n${lines}\n\n` +
          `Either add the missing verb to the matching MCP tool's enum + routing table, ` +
          `or add a rename entry to the row in cli-mcp-parity.test.ts (only when CLI and MCP names diverge by design).`
      );
    }
    expect(gaps).toEqual([]);
  });
});
