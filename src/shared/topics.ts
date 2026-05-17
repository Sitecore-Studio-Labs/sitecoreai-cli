/**
 * The intent-based command index — `scai`'s curated map of "what am I
 * trying to do" → "which commands to run, in order".
 *
 * The `--help` tree is alphabetical; this list groups commands by
 * *workflow* ("why won't this delete?", "clean up after a site
 * removal") so operators and agents reinventing an existing primitive
 * because they didn't know what to grep for is the discoverability bug
 * this addresses.
 *
 * Curated, hand-edited data — not auto-generated. It lives in `shared/`
 * (a leaf, no imports) so both surfaces consume ONE copy: the CLI
 * `scai cli topics` command renders it as text/JSON, and the MCP
 * `scai://help/topics` resource renders it as markdown. Keeping a single
 * source is the point — a topic list that drifts between the CLI and
 * the agent surface is worse than none.
 *
 * The cost is keeping this in sync when commands move; the payoff is
 * groupings that reflect workflows, not the command-tree layout.
 */

export interface TopicCommand {
  command: string;
  description: string;
}

export interface Topic {
  /** Short slug for `scai cli topics <name>`. */
  name: string;
  /** One-line description shown in the index. */
  description: string;
  /** Commands grouped under the topic, in recommended-run order. */
  commands: TopicCommand[];
}

export const TOPICS: Topic[] = [
  {
    name: "diagnose-blocked-delete",
    description: "Find out why a Sitecore item won't delete — what references hold it.",
    commands: [
      {
        command: "scai hygiene explain why-blocked <itemId>",
        description:
          "One-shot: run audit references + audit template-dependencies and merge the findings, sorted by kind",
      },
      {
        command: "scai hygiene audit references --to <itemId>",
        description:
          "Walk content fields for items whose value mentions the target (slow but broad)",
      },
      {
        command: "scai hygiene audit template-dependencies --template-id <itemId>",
        description:
          "Index-driven check for the five structural reference shapes (base-template, insert-options, …)",
      },
    ],
  },
  {
    name: "clean-orphan-content",
    description:
      "Delete the residue left after a Sites-API site delete or a subtree-removal mistake.",
    commands: [
      {
        command: "scai hygiene explain orphan-site <site>",
        description:
          "One-shot: list orphan trees for a deleted site and flag the ones still referenced by live content",
      },
      {
        command: "scai hygiene audit site-residue list",
        description:
          "Find orphan tenant/site folders in /sitecore/templates, /layout, /media library",
      },
      {
        command: "scai hygiene cleanup site-residue purge --apply",
        description: "Delete the orphans flagged by the audit; honors a pre-flight ref scan",
      },
      {
        command: "scai hygiene cleanup subtree delete --path <root> --apply",
        description:
          "Bottom-up cascade delete of a subtree; hard-blocks on external inbound references",
      },
    ],
  },
  {
    name: "manage-known-debt",
    description:
      "Accept known-good findings into a per-env baseline so CI only flags new regressions.",
    commands: [
      {
        command: "scai hygiene audit X list",
        description: "Every audit shows the baseline count under its headline (since 2026-05-14)",
      },
      {
        command: "scai hygiene audit X list --baseline",
        description: "Filter out findings already in the baseline (CI / drift mode)",
      },
      {
        command: "scai hygiene audit X list --json | scai hygiene audit baseline accept --audit X",
        description: "Pipe an audit envelope into the baseline (idempotent)",
      },
      {
        command: "scai hygiene audit baseline show / remove / reset",
        description: "Inspect and edit the baseline file (.scai/audit-baseline-<env>.json)",
      },
    ],
  },
  {
    name: "deduplicate-content",
    description: "Find and merge items with identical content hashes.",
    commands: [
      {
        command: "scai hygiene audit duplicates list",
        description: "Group items by content hash (excluding system fields by default)",
      },
      {
        command:
          "scai hygiene audit duplicates list --json | scai hygiene cleanup duplicates purge --from-stdin --apply",
        description:
          "Pipeline: skip the cleanup's internal audit re-run by piping the audit's findings in",
      },
      {
        command: "scai hygiene cleanup duplicates purge --apply",
        description:
          "Pick a survivor per group (--keep-rule) and delete the rest; pre-flight ref scan blocks unsafe deletes",
      },
    ],
  },
  {
    name: "pipeline-audit-cleanup",
    description:
      "Compose an audit + its cleanup in one shell pipeline to avoid running the same scan twice.",
    commands: [
      {
        command: "scai hygiene audit X list --json | scai hygiene cleanup X --from-stdin --apply",
        description:
          "Cleanup reads findings from stdin instead of re-running the audit; supported on duplicates today, more cleanups in follow-ups",
      },
      {
        command: "scai hygiene audit X list --json | scai hygiene audit baseline accept --audit X",
        description: "Pipe an audit envelope into the baseline (same shape — composes naturally)",
      },
    ],
  },
  {
    name: "sync-recipes-across-domains",
    description: "Capture, diff, and converge every brand kit and brief type as recipe files.",
    commands: [
      {
        command: "scai sync pull",
        description: "Enumerate every brand kit + brief type and capture each as a recipe file",
      },
      {
        command: "scai sync status",
        description: "Diff every recipe file in the workspace against the environment",
      },
      {
        command: "scai sync push --allow-write",
        description: "Converge every recipe file onto the environment (dry-run without the flag)",
      },
    ],
  },
  {
    name: "automate-with-agents",
    description: "Run scai from an MCP-compatible agent host (Claude Code, Cursor, Windsurf, …).",
    commands: [
      {
        command: "scai mcp serve",
        description:
          "Launch the stdio MCP server bound to a single environment; defers keychain access to first tool call",
      },
      {
        command: "scai mcp tools list / schema",
        description: "Offline inspector for the workflow-shaped tools the server exposes",
      },
    ],
  },
];
