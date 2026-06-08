import { Command, Option } from "commander";

const splitComma = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const collectList = (value: string, previous: string[] = []): string[] =>
  previous.concat(splitComma(value));

export const normalizeArgs = (argv: string[]): string[] => {
  // Drop a leading `--` separator (argv[2]). `pnpm dev -- <subcmd> ...`
  // injects a literal `--` before the subcommand; commander then treats
  // it as an end-of-options marker for the root program and routes
  // every subsequent flag (e.g. `--what-if`) into positional args
  // instead of parsing them. The separator carries no scai-level
  // meaning, so strip it before commander sees it. Position 2 only:
  // `--` later in argv (e.g. for a hypothetical pass-through arg) is
  // preserved.
  const cleaned = argv[2] === "--" ? [...argv.slice(0, 2), ...argv.slice(3)] : argv;
  return cleaned.map((arg) => {
    if (arg === "-fr") {
      return "--force";
    }
    if (arg === "--env" || arg === "--env-name") {
      return "--environment-name";
    }
    if (arg === "-q") {
      return "--quiet";
    }
    // `ser diff` aliases that match dotnet `Sitecore.DevEx`
    // `ser diff --source-env / --target-env [--push]`.
    if (arg === "--source-env") {
      return "--source";
    }
    if (arg === "--target-env") {
      return "--destination";
    }
    return arg;
  });
};

export const addConfigOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "-c, --config <path>",
      "Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself)."
    )
      // Second arg is the help-text label for the default. Without it
      // Commander prints the resolved absolute cwd into `--help`, which
      // is noise (and machine-specific). The runtime value is still
      // `process.cwd()`.
      .default(process.cwd(), "current directory")
  );

export const addEnvironmentOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "-n, --environment-name <name>",
      "Config environment name from sitecoreai.cli.json (alias: --env-name)"
    )
  );

/**
 * Options for an **org-scoped** command (`ops brief`, `ops campaign`,
 * `brand`): the command acts on a Sitecore organization, not an XM Cloud
 * environment. `--org-id` names the org directly; `-n/--environment-name`
 * names it indirectly via an env profile's `organizationId`. Both are
 * optional — `resolveOrganization` falls back to the sole/first env
 * profile, so a single-environment config needs neither flag.
 */
export const addOrgScopeOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  return command.addOption(
    new Option(
      "--org-id <id>",
      "Sitecore organization id to act on. Overrides the env profile's organizationId."
    )
  );
};

/**
 * Adds the shared verbosity/output flags to a command.
 *
 * `--non-interactive` is included by default, but commands that own
 * their own interactivity decision (e.g. `setup login`, where the
 * browser device flow simply cannot run headless) pass
 * `{ nonInteractive: false }` to omit it — the flag would only ever
 * produce a confusing error or be redundant there.
 */
export const addVerbosityOptions = (
  command: Command,
  options: { nonInteractive?: boolean } = {}
): Command => {
  command
    .addOption(new Option("-v, --verbose", "Write some additional diagnostic and performance data"))
    .addOption(new Option("-t, --trace", "Write more additional diagnostic and performance data"))
    .addOption(new Option("-q, --quiet", "Suppress non-error output"))
    .addOption(new Option("--json", "Output machine-readable JSON"))
    .addOption(new Option("--log-file <path>", "Write logs to a file"));
  if (options.nonInteractive !== false) {
    command.addOption(
      new Option("--non-interactive", "Disable prompts and require explicit input")
    );
  }
  return command;
};

export const addAllowWriteOption = (command: Command): Command =>
  command.option(
    "--allow-write",
    "Allow write operations for this command without updating config"
  );

export const addIncludeExcludeOptions = (command: Command): Command =>
  command
    .option(
      "-i, --include <value>",
      "Module configurations to include. Wildcards and multiple values are allowed",
      collectList,
      []
    )
    .option(
      "-e, --exclude <value>",
      "Module configurations to explicitly exclude. Wildcards and multiple values are allowed",
      collectList,
      []
    );

export const addWhatIfOption = (command: Command): Command =>
  command.option("-w, --what-if", "Lists commands that would be executed, without executing them");

/**
 * `--allow-prune` is the recipe-author-aware consent flag for recipe
 * pushes whose IR contains `PruneChildren` ops in `mode: "delete"`.
 * The op's mode is the recipe-author's intent ("I want this section's
 * unlisted children deleted"); `--allow-prune` is the operator's intent
 * ("I've reviewed the prune list in --what-if and authorize this push
 * to actually delete those items"). Both must align before the
 * executor calls `deleteItem`; either alone makes the prune a
 * rehearsal.
 *
 * Without this flag, `recipe push --apply` with delete-mode PruneChildren
 * ops in the IR fails fast with `POLICY_DENIED` rather than silently
 * degrading to a no-op. Operators set this AFTER reviewing the prune
 * list from a `--what-if` run.
 */
export const addAllowPruneOption = (command: Command): Command =>
  command.option(
    "--allow-prune",
    "Authorize deletion of items via PruneChildren ops with mode='delete'. Required IN ADDITION TO --apply when the IR contains delete-mode prunes."
  );

/**
 * `--snapshot-languages` overrides which languages the prune-rollback
 * snapshot captures per-(language, version) field values for. Comma-
 * separated ISO codes. The first language is also treated as the
 * rollback's createItem default.
 *
 * When unset, the planner AUTO-DISCOVERS via the Authoring API's
 * tenant-level `languages { nodes { name } }` connection (the XM Cloud
 * schema does NOT expose `Item.languages` — item-level discovery isn't
 * possible). The client caches the tenant language set for the run; if
 * the query errors the safety net default is `["en"]`.
 *
 * Set this when you want to bound snapshot cost (e.g. tenant has 12
 * languages but only `en` and `fr` are operationally important to
 * preserve in a rollback).
 */
export const addSnapshotLanguagesOption = (command: Command): Command =>
  command.option(
    "--snapshot-languages <list>",
    "Comma-separated ISO codes to capture in prune-rollback snapshots. When unset, auto-discovered via the Authoring API's tenant languages query. The first language becomes the inverse createItem language.",
    (value: string) =>
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
  );

/**
 * `--apply` is the universal "yes really execute" flag for destructive
 * commands. Without it, scai dry-runs as if `--what-if` were set.
 * Agent-first: no destruction without an explicit affirmative in the
 * command line.
 *
 * Pre-2026-05-14, destructive commands ran whenever the operator passed
 * `--allow-write` (cleanup) or `--force` (deploy). That made "I forgot
 * `--what-if`" the same keystroke as "delete." Inverting the default
 * costs one flag for intentional mutations and removes the muscle-
 * memory hazard for everything else.
 */
export const addApplyOption = (command: Command): Command =>
  command.option(
    "--apply",
    "Required to execute mutations. Without --apply, destructive commands dry-run as if --what-if were set."
  );

/**
 * Wrap a CLI command runner with the `--apply` gate. Without `--apply`
 * (and absent an explicit `--what-if`), the runner is invoked with
 * `whatIf: true` so it produces a plan-only output. Emits a one-line
 * stderr hint so operators don't wonder why no mutation happened.
 *
 * Use at the CLI command layer (in `.action()` handlers). Library
 * callers (MCP tools, direct programmatic use) bypass this wrapper and
 * are gated by their own contract (e.g. MCP's per-call `allowWrite`).
 */
export const withApplyGate = <T extends { apply?: boolean; whatIf?: boolean }>(
  runner: (options: T) => unknown | Promise<unknown>
): ((options: T) => Promise<void>) => {
  return async (options: T): Promise<void> => {
    let coerced = options;
    if (!options.apply && !options.whatIf) {
      process.stderr.write(
        "Dry run (no --apply flag set). Pass --apply to execute the mutation.\n"
      );
      coerced = { ...options, whatIf: true };
    }
    await runner(coerced);
  };
};

/**
 * Mark a command group as an **unstable surface**.
 *
 * Three things happen: `[unstable]` is stamped onto the `--help`
 * summary (so it shows both in the parent's command list and atop the
 * group's own help), a stability note is appended to `--help`, and a
 * one-line stderr warning is printed before any action in the group
 * runs.
 *
 * Unstable areas (`brand`, `ops brief`, `ops campaign`, `agents`) are
 * reverse-engineered from observed traffic and carry no SemVer
 * stability promise — their commands, flags, and output may change in
 * any release. The matching SDK subpaths live under `./unstable/*`;
 * see the SDK stability section in the README.
 *
 * The `preAction` hook is inherited by every subcommand, so the warning
 * fires once for `scai <area> <verb>` regardless of nesting depth. It
 * writes to stderr and is suppressed for machine-readable output
 * (`--json` / `--format json`) and `--quiet` — a JSON consumer often
 * captures the merged stdout+stderr stream (e.g. the orchestrator's
 * spawn), where this banner would corrupt the parse.
 *
 * `surface` is the user-facing command path (e.g. `"scai ops brief"`),
 * used verbatim in both the help note and the runtime warning.
 */
export const markUnstable = (command: Command, surface: string): Command => {
  command.description(`[unstable] ${command.description()}`);
  command.addHelpText(
    "after",
    `\nStability: unstable. ${surface} is reverse-engineered and carries no\n` +
      "SemVer stability promise — its commands, flags, and output may change in\n" +
      "any release without notice. See the SDK stability section in the README.\n"
  );
  command.hook("preAction", (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    // Suppress for machine-readable output (so a merged-stream consumer
    // gets pure JSON) and for --quiet.
    if (opts.quiet || opts.json === true || opts.format === "json") {
      return;
    }
    process.stderr.write(
      `⚠ ${surface} is an unstable surface — reverse-engineered, no SemVer ` +
        "stability promise; behavior may change without notice.\n"
    );
  });
  return command;
};

export const addSkipValidationOption = (command: Command): Command =>
  command.option("-s, --skip-validation", "Skips filesystem integrity validation prior to syncing");

export const addForceOption = (command: Command): Command =>
  command.option("--force", "Perform force sync. In case you have invalid includes");

export const addUseDebugSignaturesOption = (command: Command): Command =>
  command.option(
    "--use-debug-signatures",
    "Use debug (un-hashed) item signatures to diagnose hash mismatches. Much slower"
  );

export const addPublishOptions = (command: Command): Command =>
  command
    .option(
      "-p, --publish",
      "Publish synced items. Not recommended to use with Publishing Service due to performance drop"
    )
    .option(
      "--targets, --pt <value>",
      "Comma separated list of targets database to publish. Blank publishes to the default publishing target (first one in the list)",
      collectList,
      []
    );

export const addSkipPullOption = (command: Command): Command =>
  command.option("-s, --skip-pull", "Skips pulling data from Sitecore before starting the watcher");

export const addAllowFileChangesOption = (command: Command): Command =>
  command.option(
    "--allow-file-changes",
    "Don't stop watch if files change. May result in tree corruption if underlying state is changed; use only if some other program is touching serialized files that are not changing"
  );

export const addExplainOptions = (command: Command): Command =>
  command
    .option("-p, --path <path>", "Item path to explain")
    .option("-d, --database <database>", "Database of the item path to explain (default: master)");

export const addDiffOptions = (command: Command): Command =>
  command
    .option(
      "-s, --source <name>",
      "Named Sitecore endpoint to use as a source for comparison (alias: --source-env)"
    )
    .option(
      "-d, --destination <name>",
      "Named Sitecore endpoint to use as a destination for comparison (alias: --target-env)"
    )
    .option("-p, --path <path>", "Item path to compare (instead of include/exclude)")
    .option("--source-database <database>", "Source database (when used with --path)")
    .option("--destination-database <database>", "Destination database (when used with --path)")
    .option("--push", "Applies the differences detected to the destination (diff + push)")
    .option(
      "-w, --what-if",
      "With --push: builds the plan and prints it without writing to the destination"
    )
    .option(
      "--allow-write",
      "With --push: allow writes to the destination for this invocation without updating config"
    )
    .option(
      "--force",
      "With --push: skip the empty-source confirmation guard. Required if source has zero items."
    );

export const addValidateOptions = (command: Command): Command =>
  command.option(
    "-f, --fix",
    "Execute possible fix operations when validating the serialized items"
  );

export const addPackageCreateOptions = (command: Command): Command =>
  command
    .option(
      "-o, --output <path>",
      "Package path to output (will have extension added if not provided)"
    )
    .option("--overwrite", "Allow overwriting an existing package");

export const addPackageInstallOptions = (command: Command): Command =>
  command
    .option("-f, --package <path>", "Package path to install from")
    .option(
      "--authority, --auth <url>",
      "Identity authority for the environment, i.e. identity server or AAD tenant URL"
    )
    .option("--cm <url>", "Sitecore content management hostname to connect to")
    .option(
      "--client-id <id>",
      "The OAuth ClientID to send. Defaults to 'Device' for device auth, and 'SitecoreCLIServer' for client credentials"
    )
    .option(
      "--client-secret <secret>",
      "The OAuth client secret to send. Only used for client credentials authentication"
    );
