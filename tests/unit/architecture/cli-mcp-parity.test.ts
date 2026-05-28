/**
 * Architecture guardrail: for discriminated MCP tools, every CLI group
 * must map to at least one MCP verb (or be explicitly accounted for).
 * This is the narrower companion to `runner-reachability.test.ts` —
 * that test catches "task exists but nothing imports it"; this one
 * catches "imported by an MCP tool but missing from the routing table"
 * (the original site-residue / workflow-advance drift).
 *
 * Each entry binds a CLI factory + MCP tool name + per-rename map. Add
 * a row when a new discriminated MCP tool ships; add a domain's
 * `*_inspect` / `*_manage` / `*_recipe_inspect` rows together so the
 * union of their verbs covers the whole CLI command group.
 *
 * The discriminator field is `verb` by default; set `verbField:
 * "action"` for tools that discriminate on `action` (e.g.
 * `brand_manage`). CLI subcommands that map to something OTHER than a
 * verb — a verbless single-purpose tool, or an intentionally CLI-only
 * command — are listed in `nonVerbCoverage` with an explanation.
 *
 * `cleanup` keeps its dedicated `tests/unit/mcp/tools/cleanup.test.ts`;
 * `audit` is covered by the routing-table test at the bottom of this
 * file (its CLI shape — one subcommand per audit — does not fit the
 * verb model). `deploy` and `recipe` use separate non-discriminated
 * tools and are out of scope here.
 */

import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { z, ZodEnum } from "zod";

type VerbField = "verb" | "action";

interface ParityRow {
  /** Friendly label for failure messages. */
  domain: string;
  /** CLI command factory — returns the Commander group whose subcommands are the CLI verbs. */
  cliFactory: () => Promise<Command>;
  /** MCP tool name (must be verb- or action-discriminated). */
  mcpTool: string;
  /** Discriminator field on the MCP tool's input schema. Default `verb`. */
  verbField?: VerbField;
  /**
   * Optional rename map: CLI subcommand name → MCP verb name.
   * Only needed when the names don't match by equality or the
   * `startsWith(group + "-")` prefix rule. Each entry is a debt note
   * — naming-alignment is preferred over a permanent rename row.
   */
  renames?: Record<string, string>;
  /**
   * CLI subcommands covered by something OTHER than a discriminator
   * verb — a verbless single-purpose tool (`brand_review`,
   * `agents_run`), a `resource`-keyed branch, or an intentionally
   * CLI-only command. Key = CLI subcommand, value = explanation.
   * Merged across every row of the domain.
   */
  nonVerbCoverage?: Record<string, string>;
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
  },
  {
    // `scai hygiene explain` ⟷ the `explain` MCP tool — verbs match 1:1.
    domain: "explain → explain (composed-audit verbs)",
    cliFactory: async () => {
      const { createExplainCommand } = await import("../../../src/commands/explain");
      return createExplainCommand();
    },
    mcpTool: "explain",
  },
  {
    // `scai sync` ⟷ the `recipe_sync` MCP tool — verbs match 1:1.
    domain: "sync → recipe_sync (cross-domain aggregate verbs)",
    cliFactory: async () => {
      const { createSyncCommand } = await import("../../../src/commands/sync");
      return createSyncCommand();
    },
    mcpTool: "recipe_sync",
  },
  // --- Content Operations: brief --------------------------------------
  {
    domain: "brief → brief_inspect (read verbs)",
    cliFactory: async () => {
      const { createBriefCommand } = await import("../../../src/commands/brief");
      return createBriefCommand();
    },
    mcpTool: "brief_inspect",
  },
  {
    domain: "brief → brief_manage (mutating verbs)",
    cliFactory: async () => {
      const { createBriefCommand } = await import("../../../src/commands/brief");
      return createBriefCommand();
    },
    mcpTool: "brief_manage",
  },
  {
    domain: "brief → brief_recipe_inspect (recipe sync)",
    cliFactory: async () => {
      const { createBriefCommand } = await import("../../../src/commands/brief");
      return createBriefCommand();
    },
    mcpTool: "brief_recipe_inspect",
    // CLI `brief sync` is the per-domain recipe pull/diff/push group;
    // the MCP recipe tools expose pull/diff (push is verbless).
    renames: {
      sync: "pull",
    },
  },
  // --- Content Operations: campaign -----------------------------------
  {
    domain: "campaign → campaign_inspect (read verbs)",
    cliFactory: async () => {
      const { createCampaignCommand } = await import("../../../src/commands/campaign");
      return createCampaignCommand();
    },
    mcpTool: "campaign_inspect",
  },
  {
    domain: "campaign → campaign_manage (mutating verbs)",
    cliFactory: async () => {
      const { createCampaignCommand } = await import("../../../src/commands/campaign");
      return createCampaignCommand();
    },
    mcpTool: "campaign_manage",
    nonVerbCoverage: {
      // The `deliverable` CLI group maps to campaign_manage's
      // `resource: 'deliverable'` branch, not a distinct verb.
      deliverable: "campaign_manage with resource='deliverable' (create/delete verbs)",
    },
  },
  {
    domain: "campaign → campaign_recipe_inspect (recipe sync)",
    cliFactory: async () => {
      const { createCampaignCommand } = await import("../../../src/commands/campaign");
      return createCampaignCommand();
    },
    mcpTool: "campaign_recipe_inspect",
    renames: {
      sync: "pull",
    },
  },
  // --- Brand ----------------------------------------------------------
  {
    domain: "brand → brand_inspect (read verbs)",
    cliFactory: async () => {
      const { createBrandCommand } = await import("../../../src/commands/brand");
      return createBrandCommand();
    },
    mcpTool: "brand_inspect",
    // CLI groups are coarse (`kits`, `docs`); the MCP read verbs are
    // finer-grained — map each CLI group to its representative verb.
    renames: {
      kits: "list-kits",
      docs: "list-docs",
    },
  },
  {
    domain: "brand → brand_manage (mutating actions)",
    cliFactory: async () => {
      const { createBrandCommand } = await import("../../../src/commands/brand");
      return createBrandCommand();
    },
    mcpTool: "brand_manage",
    verbField: "action",
    // `ingest` / `enrich` run the two AI pipelines; the MCP actions
    // are named after the pipeline classes.
    renames: {
      ingest: "run-ingestion",
      enrich: "run-enrichment",
    },
    nonVerbCoverage: {
      review: "brand_review (single-purpose tool, no verb discriminator)",
    },
  },
  {
    domain: "brand → brand_recipe_inspect (recipe sync)",
    cliFactory: async () => {
      const { createBrandCommand } = await import("../../../src/commands/brand");
      return createBrandCommand();
    },
    mcpTool: "brand_recipe_inspect",
    renames: {
      sync: "pull",
    },
  },
  // --- Agentic Studio: agents -----------------------------------------
  {
    domain: "agents → agents_inspect (read verbs)",
    cliFactory: async () => {
      const { createAgentsCommand } = await import("../../../src/commands/agents");
      return createAgentsCommand();
    },
    mcpTool: "agents_inspect",
    // CLI groups are singular (`agent`, `skill`); MCP read verbs are
    // plural (`agents`, `skills`).
    renames: {
      agent: "agents",
      skill: "skills",
      widget: "widgets",
      schema: "schemas",
      mcp: "mcps",
      tool: "tools",
    },
    nonVerbCoverage: {
      login: "CLI-only — interactive browser-session capture; there is no token path",
      logout: "CLI-only — clears the stored Agentic Studio session",
      space: "spaces are run-scoped — `agents_run` creates one; there is no inspect verb",
      "html-template": "UNVERIFIED surface (405/404); intentionally not on the MCP",
    },
  },
  {
    domain: "agents → agents_recipe_inspect (recipe sync)",
    cliFactory: async () => {
      const { createAgentsCommand } = await import("../../../src/commands/agents");
      return createAgentsCommand();
    },
    mcpTool: "agents_recipe_inspect",
    renames: {
      sync: "pull",
    },
  },
];

const getMcpVerbs = async (toolName: string, verbField: VerbField): Promise<string[]> => {
  const { buildScaiMcpRegistry } = await import("../../../src/mcp/build-registry");
  const reg = buildScaiMcpRegistry();
  const tool = reg.getTool(toolName);
  if (!tool) throw new Error(`MCP tool '${toolName}' not registered.`);
  const field = (tool.inputSchema as Record<string, z.ZodType | undefined>)[verbField];
  if (!field) throw new Error(`MCP tool '${toolName}' has no \`${verbField}\` field.`);
  const options = (field as unknown as ZodEnum<[string, ...string[]]>).options;
  return [...options];
};

/**
 * Check whether the CLI group name has any matching verb in the MCP
 * tool's enum, applying:
 *   - direct equality (group === verb)
 *   - prefix rule (verb starts with `group-`)
 *   - explicit rename map
 *   - non-verb coverage (verbless tool / resource branch / CLI-only)
 */
const matchesVerb = (
  group: string,
  verbs: readonly string[],
  renames: Record<string, string>,
  nonVerbCoverage: Record<string, string>
): boolean => {
  if (nonVerbCoverage[group]) return true;
  if (renames[group] && verbs.includes(renames[group])) return true;
  return verbs.some((v) => v === group || v.startsWith(`${group}-`));
};

describe("architecture: CLI/MCP verb parity", () => {
  it("every CLI group is covered by at least one MCP verb across the domain's tools", async () => {
    // Group rows by CLI command name (each domain may have read +
    // write + recipe tools; the union of their verbs is what we check).
    const byDomain = new Map<string, { rows: ParityRow[]; verbs: Set<string>; groups: string[] }>();
    for (const row of PARITY_ROWS) {
      const cmd = await row.cliFactory();
      const key = cmd.name();
      const verbs = await getMcpVerbs(row.mcpTool, row.verbField ?? "verb");
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
      // Merge rename + non-verb-coverage maps across the rows for this
      // domain so an entry declared on any tool's row applies.
      const renames = rows.reduce<Record<string, string>>(
        (acc, r) => ({ ...acc, ...(r.renames ?? {}) }),
        {}
      );
      const nonVerbCoverage = rows.reduce<Record<string, string>>(
        (acc, r) => ({ ...acc, ...(r.nonVerbCoverage ?? {}) }),
        {}
      );
      for (const group of groups) {
        if (!matchesVerb(group, verbList, renames, nonVerbCoverage)) {
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
          `add a rename entry (when CLI and MCP names diverge by design), or add a ` +
          `nonVerbCoverage entry (when the CLI command maps to a verbless tool or is ` +
          `intentionally CLI-only) to the row in cli-mcp-parity.test.ts.`
      );
    }
    expect(gaps).toEqual([]);
  });

  it("audit_inspect can run every CLI-registered audit", async () => {
    // `audit`'s CLI shape — one subcommand per audit — does not fit the
    // verb model. The parity that matters: the MCP `audit_inspect`
    // verb='run' routing table (`SINGLE_AUDIT_RUNNERS`) must cover
    // exactly the audits the CLI registers (`AUDIT_REGISTRY`). A new
    // audit added to one side but not the other fails here.
    const { SINGLE_AUDIT_RUNNERS } = await import("../../../src/mcp/tools/audit");
    const { auditNames } = await import("../../../src/hygiene/tasks/audit/all");
    expect(Object.keys(SINGLE_AUDIT_RUNNERS).sort()).toEqual([...auditNames()].sort());
  });
});
