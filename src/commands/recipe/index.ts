import { Command, Option } from "commander";
import {
  addAllowPruneOption,
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addSnapshotLanguagesOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";
import { runRecipeCompile } from "../../recipe/tasks/compile";
import { runRecipeDiff } from "../../recipe/tasks/diff";
import { runRecipeList } from "../../recipe/tasks/list";
import { runRecipePlan } from "../../recipe/tasks/plan";
import { runRecipePruneDefaults } from "../../recipe/tasks/prune-defaults";
import { runRecipePull } from "../../recipe/tasks/pull";
import { runRecipePush } from "../../recipe/tasks/push";
import { runRecipeRoots } from "../../recipe/tasks/roots";
import { createScaiError } from "../../shared/errors";

const addOptionalInputOption = (command: Command, label: string): Command =>
  command.addOption(
    new Option(
      "-i, --input <path>",
      `${label}. Defaults to the config \`recipes\` glob from sitecoreai.cli.json.`
    )
  );

const addRequiredInputOption = (command: Command, label: string): Command =>
  command.addOption(new Option("-i, --input <path>", label).makeOptionMandatory(true));

const addOutputOption = (command: Command): Command =>
  command.addOption(new Option("-o, --output <path>", "Path to write the output file"));

// All flags are optional. Each falls back to the matching field on
// envProfiles[<name>] in sitecoreai.cli.json. resolveRecipeRoots() throws
// `INPUT_INVALID` for templatesRoot / renderingsRoot when neither source
// is set AND the recipe set contains a kind that creates template or
// rendering items; a workflow- / webhook-authorization-only set needs
// neither. The Phase 4 composition roots are optional and only surface
// errors when their corresponding recipe kinds are being compiled.
const addRecipeRootOptions = (command: Command): Command =>
  command
    .addOption(
      new Option(
        "--templates-root <path>",
        "Sitecore parent path for template items. Falls back to envProfiles[<name>].templatesRoot."
      )
    )
    .addOption(
      new Option(
        "--renderings-root <path>",
        "Sitecore parent path for rendering items. Falls back to envProfiles[<name>].renderingsRoot."
      )
    )
    .addOption(
      new Option(
        "--components-root <path>",
        "Sitecore parent path for component template items in the per-site folder layout (Phase 2). Falls back to envProfiles[<name>].componentsRoot."
      )
    )
    .addOption(
      new Option(
        "--content-models-root <path>",
        "Sitecore parent path for content-template items (Phase 2). Falls back to envProfiles[<name>].contentModelsRoot."
      )
    )
    .addOption(
      new Option(
        "--partial-designs-root <path>",
        "Sitecore parent path for partial-design items (Phase 4). Falls back to envProfiles[<name>].partialDesignsRoot."
      )
    )
    .addOption(
      new Option(
        "--page-designs-root <path>",
        "Sitecore parent path for page-design items (Phase 4). Falls back to envProfiles[<name>].pageDesignsRoot."
      )
    )
    .addOption(
      new Option(
        "--content-items-root <path>",
        "Sitecore parent path for shared content items (Phase 4). Falls back to envProfiles[<name>].contentItemsRoot."
      )
    )
    .addOption(
      new Option(
        "--media-library-root <path>",
        "Media-library folder for recipe-materialised media (external-URL image fields upload here). Falls back to envProfiles[<name>].mediaLibraryRoot, else /sitecore/media library/RecipeImages/<site>."
      )
    )
    .addOption(
      new Option(
        "--image-defaults <path>",
        "JSON file mapping image roles to external URLs (role \u2192 https URL). Image fields/SV defaults declaring a matching `role` materialise the mapped URL instead of the recipe's stock default \u2014 per-brand imagery from one brand-agnostic recipe. Substituted images upload ONCE per (site, role) into the site-level `Defaults` media folder and are shared by every consuming component. Falls back to SITECOREAI_IMAGE_DEFAULTS (also a path)."
      )
    );

const createCompileCommand = (): Command => {
  const command = new Command("compile").description(
    "Compile recipe (.ts/.json) files to Operation IR JSON files"
  );

  addOptionalInputOption(command, "Path to a recipe file");
  addOutputOption(command);
  addRecipeRootOptions(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runRecipeCompile(options));
  return command;
};

const createListCommand = (): Command => {
  const command = new Command("list").description(
    "List the recipe set in apply order — pure-logic, no tenant. Emits { handle, kind } per recipe (use --json)."
  );

  addOptionalInputOption(command, "Path to a recipe file");
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runRecipeList(options));
  return command;
};

const createPlanCommand = (): Command => {
  const command = new Command("plan").description(
    "Plan an Operation IR push against a tenant — read-then-diff, no mutations"
  );

  addRequiredInputOption(command, "Path to a compiled .ir.json file");
  addOutputOption(command);
  addEnvironmentOption(command);
  addSnapshotLanguagesOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runRecipePlan(options);
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff").description(
    "Show what `recipe push` would change — read-only diff against a tenant. Compiles recipes in-memory; never mutates."
  );

  addOptionalInputOption(
    command,
    "Path to a recipe file (.recipe.ts/.json) or pre-compiled .ir.json"
  );
  addRecipeRootOptions(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runRecipeDiff(options);
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push").description(
    "Apply recipes to a tenant. Compiles in-memory and runs the executor with idempotency + best-effort rollback."
  );

  addOptionalInputOption(
    command,
    "Path to a recipe file (.recipe.ts/.json) or pre-compiled .ir.json"
  );
  addRecipeRootOptions(command);
  addEnvironmentOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addAllowPruneOption(command);
  addSnapshotLanguagesOption(command);
  command.addOption(
    new Option(
      "--skip-unchanged-recipes",
      "Skip recipes whose compiled IR digest matches the cached entry from the previous successful push (.scai/recipe-cache.json). Off by default — opt in for fast re-pushes of an unchanged recipe set."
    )
  );
  command.addOption(
    new Option(
      "--plan-concurrency <n>",
      "Number of recipes plan-mode (--what-if) runs concurrently. Defaults to 4. Apply mode is always sequential per-recipe."
    ).argParser((value: string) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--plan-concurrency must be a positive integer.");
      }
      return parsed;
    })
  );
  command.addOption(
    new Option(
      "--conflict-policy <policy>",
      "Three-way merge resolution for tenant-side author edits since the last push. `error` (default) blocks the apply on any conflict; `recipe-wins` clobbers the author edit; `cms-wins` preserves it and drops the recipe-side change for this push."
    )
      .choices(["error", "recipe-wins", "cms-wins"])
      .default("error")
  );
  command.addOption(
    new Option(
      "--no-baseline",
      "Skip three-way merge baseline loading + post-apply writing. Recipe becomes a legacy two-way diff (recipe-wins on every drift). Use for first-push test runs against a clean tenant or CI runs where the baseline isn't checked in."
    )
  );
  command.addOption(
    new Option(
      "--handles <list>",
      "Comma-separated list of recipe handles to narrow the push to. Cross-recipe references still resolve against the full input set; only matched handles are applied. Unknown handles are logged and ignored. Aligns with the `handles` field convention the orchestrator's brief/campaign sync plans use."
    ).argParser((value: string) =>
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    const results = await runRecipePush(options);
    // Surface failure to the caller's exit code. `runRecipePush` returns
    // a non-empty array even when every recipe aborted with errors —
    // without this guard, the CLI exits 0 and orchestrators (or CI)
    // can't tell a successful push from a 100%-failed one.
    const failed = results.some((result) => result.aborted || result.summary.error > 0);
    // Three-way merge: conflict actions block the apply at the planner
    // layer (the action's status is "conflict" so no mutation runs), but
    // the recipe-level result doesn't auto-abort — surface it here so the
    // CLI exits non-zero and the operator sees the conflict list. Skipped
    // when --conflict-policy isn't "error" (recipe-wins / cms-wins already
    // resolved the conflicts inline; summary.conflict stays 0 in those
    // cases).
    const conflicted = results.some((result) => result.summary.conflict > 0);
    if (failed || conflicted) {
      const abortedRecipes = results.filter((r) => r.aborted);
      const errored = results.reduce((acc, r) => acc + r.summary.error, 0);
      // Pull each aborted recipe's last action's reason / rollback summary
      // so the top-level error message names which recipes failed and (if
      // the action's reason is set) why. Truncated event logs in
      // orchestrator stdout often hide the apply-error events; surfacing
      // it here makes diagnosis cheap.
      const abortDetails = abortedRecipes.map((r) => {
        const lastAction = r.plan.actions[r.plan.actions.length - 1];
        const rollback = r.rollback
          ? ` rolled back ${r.rollback.rolledBack} of ${
              r.plan.actions.filter((a) => a.mutation).length
            } applied`
          : "";
        return `${r.plan.recipeHandle}: ${lastAction?.operation.label ?? "(unknown op)"} — ${
          lastAction?.reason ?? "apply error (see events[])"
        }${rollback}`;
      });
      // Conflict surface — one line per (recipe, op) that the three-way
      // merge classified as conflict. Includes the conflict reason from
      // the planner ("conflict: tenant and recipe both diverged …" or
      // "cms-edit: author edited tenant after last push …").
      const conflictDetails: string[] = [];
      for (const r of results) {
        if (r.summary.conflict === 0) continue;
        for (const action of r.plan.actions) {
          if (action.status !== "conflict") continue;
          conflictDetails.push(
            `${r.plan.recipeHandle}: ${action.operation.label} — ${action.reason ?? "conflict"}`
          );
        }
      }
      const totalConflicts = results.reduce((acc, r) => acc + r.summary.conflict, 0);
      const summarySegments: string[] = [];
      if (abortedRecipes.length > 0)
        summarySegments.push(`${abortedRecipes.length} of ${results.length} recipe(s) aborted`);
      if (errored > 0) summarySegments.push(`${errored} op error(s)`);
      if (totalConflicts > 0) summarySegments.push(`${totalConflicts} three-way merge conflict(s)`);
      throw createScaiError(`Recipe push failed: ${summarySegments.join("; ")}.`, "DEPLOY_FAILED", {
        hint:
          totalConflicts > 0 && !failed
            ? "Pass --conflict-policy=recipe-wins to clobber the author edits, or =cms-wins to preserve them and drop the recipe-side change for this push."
            : "Inspect per-op `events[]` in the JSON output (or rerun with --verbose) to see which op aborted and why.",
        details: [...abortDetails, ...conflictDetails],
      });
    }
  });
  return command;
};

const createPullCommand = (): Command => {
  const command = new Command("pull").description(
    "Read tenant state and dump every reverse-projectable recipe to disk as .recipe.json. Read-only — does not mutate the tenant. Default snapshot mode dumps everything to <out>; `--against <recipes-dir>` enables three-way merge detection (in-sync / disk-ahead / tenant-edited / conflict)."
  );
  command.addOption(
    new Option("-o, --output <path>", "Output directory. Defaults to ./pulled-recipes.")
  );
  command.addOption(
    new Option(
      "--against <recipes-dir>",
      "Path to authored recipes directory (or single recipe file). Enables merge-detection mode: compares the tenant projection against your local recipes + baseline and classifies each recipe. Use `--against .` to use the config glob from sitecoreai.cli.json."
    )
  );
  command.addOption(
    new Option(
      "--conflict-policy <policy>",
      "Merge-mode conflict policy (mirrors push's, direction-inverted). `error` (default) exits non-zero on tenant-edited / conflict; `disk-wins` skips writes for recipes with disk changes; `tenant-wins` writes every tenant projection regardless. Only used with --against."
    )
      .choices(["error", "disk-wins", "tenant-wins"])
      .default("error")
  );
  command.addOption(
    new Option(
      "--no-baseline",
      "Skip three-way merge baseline loading. Without a baseline, any divergence classifies as conflict (we can't tell who moved)."
    )
  );
  command.addOption(
    new Option(
      "--write-plan <path>",
      "Write a merge-plan JSON file with every per-recipe per-field classification + the default winner per --conflict-policy. Hand-editable: operator opens the file, flips `winner` to `disk` or `tenant` per field, then re-runs `recipe pull --apply-plan <same-path>` to commit. Implies merge mode (--against must be set)."
    )
  );
  command.addOption(
    new Option(
      "--apply-plan <path>",
      "Read a merge-plan JSON file and use its `winner` picks per field instead of --conflict-policy. Pull rebuilds classifications + verifies the plan still matches the current tenant + disk state; refuses to apply a stale plan. Implies merge mode."
    )
  );
  command.addOption(
    new Option(
      "--dry-run",
      "Classify + report what WOULD be written without writing any files (no recipe JSON files, no merge plan). Useful in CI for verifying tenant + disk are in sync without leaving runner-FS artifacts."
    )
  );
  addRecipeRootOptions(command);
  command.addOption(
    new Option(
      "--pages-root <path>",
      "Sitecore parent path for page items. Falls back to envProfiles[<name>].pagesRoot."
    )
  );
  command.addOption(
    new Option(
      "--enumerations-root <path>",
      "Sitecore parent path for enumeration containers. Falls back to envProfiles[<name>].enumerationsRoot."
    )
  );
  command.addOption(
    new Option(
      "--placeholder-settings-root <path>",
      "Sitecore parent path for Placeholder Settings items. Falls back to envProfiles[<name>].placeholderSettingsRoot."
    )
  );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    const result = await runRecipePull(options);
    // Merge-mode --policy=error blocks on tenant-edited / conflict.
    // Surface as CLI non-zero so CI / orchestrators see the same signal
    // as `push` would on conflict.
    if (result.blocked) {
      throw createScaiError(
        `Recipe pull blocked: ${result.byStatus["tenant-edited"]} tenant-edited + ${result.byStatus.conflict} conflict recipe(s) need manual reconciliation.`,
        "DEPLOY_FAILED",
        {
          hint: "Pass --conflict-policy=tenant-wins to adopt the tenant changes, or =disk-wins to keep your local recipes. Or reconcile by hand and re-run.",
          details: result.files
            .filter((f) => f.status === "tenant-edited" || f.status === "conflict")
            .map(
              (f) =>
                `${f.handle}: ${f.status}` +
                (f.diskChangedFields || f.tenantChangedFields
                  ? ` (disk:${f.diskChangedFields}, tenant:${f.tenantChangedFields})`
                  : "")
            ),
        }
      );
    }
  });
  return command;
};

const createPruneDefaultsCommand = (): Command => {
  const command = new Command("prune-defaults").description(
    "Remove the SXA Headless OOTB child folders under Available Renderings (Media, Navigation, Page Content, Page Structure), Headless Variants (Image, LinkList, Navigation, Page Content, Promo, Rich Text, Title), Data (Images, Link Lists, Navigation Filters, Promos, Texts — Tags is preserved), and Presentation/Styles (Spacing, Add Highlight, Content Alignment, Background Color, Background Layout, Navigation, Link List, Rich Text, Promo, Image, Common, Container). Keeps the parent folders. Idempotent — missing items are skipped, not errored."
  );

  command.addOption(
    new Option(
      "--headless-variants-root <path>",
      "Override headlessVariantsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Headless Variants)."
    )
  );
  command.addOption(
    new Option(
      "--available-renderings-root <path>",
      "Override availableRenderingsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Available Renderings)."
    )
  );
  command.addOption(
    new Option(
      "--content-items-root <path>",
      "Override contentItemsRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Data)."
    )
  );
  command.addOption(
    new Option(
      "--media-library-root <path>",
      "Override mediaLibraryRoot from the env profile (e.g. /sitecore/media library/Project/<col>/<site>)."
    )
  );
  command.addOption(
    new Option(
      "--presentation-styles-root <path>",
      "Override presentationStylesRoot from the env profile (e.g. /sitecore/content/<col>/<site>/Presentation/Styles)."
    )
  );
  addEnvironmentOption(command);
  addWhatIfOption(command);
  addAllowWriteOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runRecipePruneDefaults(options);
  });
  return command;
};

const createRootsCommand = (): Command => {
  const command = new Command("roots").description(
    "Print the recipeRoots derived from a site (+ collection). Read-only — paste the output into envProfiles.<name>.recipeRoots in sitecoreai.cli.json, or inspect what `recipe push` will use."
  );

  command.addOption(
    new Option(
      "--site <name>",
      "SXA Headless site name to derive roots for. Falls back to envProfiles[<name>].site."
    )
  );
  command.addOption(
    new Option(
      "--site-collection <name>",
      "SXA Headless site collection (parent tenant). Falls back to envProfiles[<name>].siteCollection, else discovered from the environment."
    )
  );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => runRecipeRoots(options));
  return command;
};

export const createRecipeCommand = (): Command => {
  const command = new Command("recipe").description(
    "Compile, plan, and push declarative recipes to Sitecore"
  );

  command.addCommand(createCompileCommand());
  command.addCommand(createListCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPlanCommand());
  command.addCommand(createPullCommand());
  command.addCommand(createPushCommand());
  command.addCommand(createPruneDefaultsCommand());
  command.addCommand(createRootsCommand());

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  # Compile a single recipe to IR",
      "  $ scai provision recipe compile -i ./recipes/cta-button.recipe.ts \\",
      '      --templates-root "/sitecore/templates/Project/my-site/Components" \\',
      '      --renderings-root "/sitecore/layout/Renderings/Project/my-site"',
      "",
      "  # Plan against a tenant from a pre-compiled IR",
      "  $ scai provision recipe plan -i ./recipes/.scai/cta-button_v1.ir.json -n my-tenant",
      "",
      "  # Diff every recipe in the config glob against a tenant (read-only)",
      "  $ scai provision recipe diff -n my-tenant",
      "",
      "  # Push every recipe in the config glob (default `recipes/**/*.recipe.ts`)",
      "  $ scai provision recipe push -n my-tenant --what-if",
      "  $ scai provision recipe push -n my-tenant --allow-write",
      "",
      "  # Push a single recipe explicitly",
      "  $ scai provision recipe push -i ./recipes/cta-button.recipe.ts -n my-tenant --allow-write",
      "",
      "  # Snapshot: pull tenant state to ./pulled-recipes (does NOT mutate the tenant)",
      "  $ scai provision recipe pull -n my-tenant -o ./pulled-recipes",
      "",
      "  # Merge: compare tenant against your local recipes, exit non-zero on conflict",
      "  $ scai provision recipe pull -n my-tenant --against ./recipes",
      "",
      "  # Merge + adopt author edits (overwrite pulled-recipes with tenant projection)",
      "  $ scai provision recipe pull -n my-tenant --against ./recipes --conflict-policy=tenant-wins",
      "",
      "  # Preview the SXA OOTB prune (no mutations)",
      "  $ scai provision recipe prune-defaults -n my-tenant --what-if",
      "",
      "  # Apply the SXA OOTB prune",
      "  $ scai provision recipe prune-defaults -n my-tenant --allow-write",
      "",
      "  # Print the recipeRoots derived from a site (paste into sitecoreai.cli.json)",
      "  $ scai provision recipe roots --site my-site --site-collection MyTenant --json",
      "  # ...or let scai discover the collection from the environment",
      "  $ scai provision recipe roots --site my-site -n my-tenant",
    ].join("\n")
  );

  return command;
};
