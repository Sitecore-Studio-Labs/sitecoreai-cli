/**
 * The scai Commander program tree — assembled here, with **no
 * import-time side effects**, so it can be consumed both by the CLI
 * entrypoint (`src/cli.ts`, which runs it) and by tooling that only
 * needs to inspect the command structure (`scripts/generate-commands-doc.ts`).
 *
 * `src/cli.ts` keeps the runtime concerns — argv normalization, the
 * auto-wizard, telemetry, the force-exit teardown — and calls
 * `createProgram` to build the tree. Anything that adds a top-level
 * command group belongs here.
 */

import { Command } from "commander";
import packageJson from "../package.json";
import { createAuditCommand } from "./commands/audit";
import { createBrandCommand } from "./commands/brand";
import { createCleanupCommand } from "./commands/cleanup";
import { createSerializationCommand } from "./commands/serialization";
import { createStatusCommand } from "./commands/status";
import { createLoginCommand } from "./commands/login";
import { createDeployCommand } from "./commands/deploy";
import { createExplainCommand } from "./commands/explain";
import { createHealthCommand } from "./commands/health";
import { createHistoryCommand } from "./commands/history";
import { createInitCommand } from "./commands/init";
import { createLogoutCommand } from "./commands/logout";
import { createSetupClientCommand } from "./commands/setup-client";
import { createMcpCommand } from "./commands/mcp";
import { createPolicyCommand } from "./commands/policy";
import { createBriefCommand } from "./commands/brief";
import { createCampaignCommand } from "./commands/campaign";
import { createAgentsCommand } from "./commands/agents";
import { createPublishCommand } from "./commands/publish";
import { createTopicsCommand } from "./commands/topics";
import { createRecipeCommand } from "./commands/recipe";
import { createSyncCommand } from "./commands/sync";
import { createShellCommand } from "./commands/shell";
import { createConfigCommand } from "./commands/config";
import { createTelemetryCommand } from "./commands/telemetry";
import { createWebhookCommand } from "./commands/webhook";
import { createWorkflowCommand } from "./commands/workflow";
import { markUnstable } from "./commands/shared";

/** Env snapshot the shell REPL restores between sub-invocations. */
export type RunCliOptions = {
  baseEnv?: Record<string, string | undefined>;
  skipBanner?: boolean;
  shellMode?: boolean;
};

/**
 * The CLI runner — `src/cli.ts` supplies the real implementation. The
 * shell command needs a callback to re-enter the CLI for each typed
 * line; `createProgram` threads it through without importing the
 * entrypoint (which would re-trigger its side effects).
 */
export type RunCli = (argv: string[], options?: RunCliOptions) => Promise<void>;

/**
 * Build the full nested Commander tree. The CLI surface is organized by
 * product area, not flat — each parent below is a namespace, and the
 * leaf command builders are unchanged (only where they attach).
 *
 * Pure: no side effects beyond constructing `Command` objects.
 */
export const createProgram = (runCli: RunCli, options: { shellMode?: boolean } = {}): Command => {
  const program = new Command();
  program
    .name("scai")
    .description(
      "SitecoreAI developer toolkit — deploy, serialization, recipes, publishing, and MCP"
    )
    .version(packageJson.version, "-V, --version", "Display the CLI version");

  // Top-level command groups. The CLI surface is organized by product
  // area, not flat — each parent below is a namespace, and the leaf
  // command builders are unchanged (only where they attach moved).
  const setup = new Command("setup").description(
    "Configure environments and authenticate — init, login, env, logout, status"
  );
  setup.addCommand(createInitCommand());
  setup.addCommand(createLoginCommand());
  setup.addCommand(createSetupClientCommand());
  setup.addCommand(createLogoutCommand());
  setup.addCommand(createStatusCommand());

  const hygiene = new Command("hygiene").description(
    "Content quality — read-only audits, mutating cleanup, and composed diagnostics"
  );
  hygiene.addCommand(createAuditCommand());
  hygiene.addCommand(createCleanupCommand());
  hygiene.addCommand(createExplainCommand());

  // `webhook` nests under `workflow`; the old standalone `content`
  // wrapper is dropped — its only child (`version`) attaches directly.
  const workflow = createWorkflowCommand();
  workflow.addCommand(createWebhookCommand());
  const content = new Command("content").description(
    "Operate on content items — publish and workflow handlers"
  );
  content.addCommand(createPublishCommand());
  content.addCommand(workflow);
  // `content version` (per-version publish-state fields — __Never publish,
  // __Valid from / __Valid to) is intentionally NOT registered yet. Those
  // fields only make sense once content items (pages, etc.) can be authored
  // through the CLI; today they only arrive via recipes, so a lone
  // version-state verb is more confusing than useful. The SDK
  // (src/content/api/version-fields.ts) and `hygiene cleanup versions` both
  // stay — only this CLI command group is hidden until item primitives land.
  // content.addCommand(createContentVersionCommand());
  content.addHelpText(
    "after",
    "\nRoadmap: `scai content sites` and `scai content pages` — XM Cloud\n" +
      "site and page management — are planned, not yet shipped. See docs/roadmap.md.\n"
  );

  // `brief`, `campaign`, `brand`, and `agents` are unstable surfaces —
  // reverse-engineered, no SemVer stability promise. `markUnstable`
  // stamps the `[unstable]` help marker, the stability note, and the
  // per-invocation stderr warning onto each group.
  const ops = new Command("ops").description("Sitecore Content Operations — briefs and campaigns");
  ops.addCommand(markUnstable(createBriefCommand(), "scai ops brief"));
  ops.addCommand(markUnstable(createCampaignCommand(), "scai ops campaign"));

  const provision = new Command("provision").description(
    "Provision environments and content-as-code — deploy, serialization, recipes"
  );
  provision.addCommand(createDeployCommand());
  provision.addCommand(createSerializationCommand());
  provision.addCommand(createRecipeCommand());
  provision.addHelpText(
    "after",
    "\nRoadmap: `scai provision iar` — package content as Items-as-Resources\n" +
      "(IAR) — is planned, not yet shipped. See docs/roadmap.md.\n"
  );

  const cli = new Command("cli").description("CLI tooling — config, diagnostics, history, REPL");
  cli.addCommand(createConfigCommand());
  cli.addCommand(createHealthCommand());
  cli.addCommand(createHistoryCommand());
  cli.addCommand(createShellCommand(runCli));
  cli.addCommand(createTelemetryCommand());
  cli.addCommand(createTopicsCommand());

  program.addCommand(setup);
  program.addCommand(createPolicyCommand());
  program.addCommand(hygiene);
  program.addCommand(content);
  program.addCommand(ops);
  program.addCommand(markUnstable(createBrandCommand(), "scai brand"));
  program.addCommand(markUnstable(createAgentsCommand(), "scai agents"));
  program.addCommand(provision);
  program.addCommand(createSyncCommand());
  // `mcp` stays top-level: `scai mcp serve` is wired into external MCP
  // client configs, so its path must not move under a group.
  program.addCommand(createMcpCommand());
  program.addCommand(cli);

  program.showHelpAfterError(true);
  program.showSuggestionAfterError(true);
  if (options.shellMode) {
    program.exitOverride();
  }
  return program;
};
