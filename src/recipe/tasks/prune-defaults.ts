import { createCliError } from "@/shared/errors";
import { Logger } from "@/shared/logger";
import type { AuthoringApiClient } from "../api/client";
import {
  ensureAllowWrite,
  resolveTenant,
  toLogger,
  type RecipeTenantOptions,
} from "./shared";

/**
 * `scai recipe prune-defaults` — remove the SXA Headless OOTB content
 * that ships with every fresh site under `Available Renderings`,
 * `Headless Variants`, and the per-site `Data` bucket. Registry installs
 * ship their own renderings, variants, and datasources; the OOTB folders
 * just noise up the authoring tree. Folder parents are preserved (we
 * keep using `Available Renderings`, `Headless Variants`, and `Data`
 * ourselves) — only the named child folders are removed. `Tags` under
 * `Data` is left alone because authors typically populate it.
 *
 * Idempotent by design: each target is `getItem`-ed first, so a missing
 * path is a clean skip rather than an error. Re-runs after a successful
 * prune produce zero deletions.
 */

const DEFAULT_PRUNE_TARGETS = {
  /**
   * `Available Renderings` children to remove. SXA ships six default
   * sections; we keep `FEaaS` (the Forms-as-a-Service rendering bucket)
   * and `Forms` (the Sitecore Forms bucket) because they're not yet
   * superseded by registry-side recipes.
   */
  availableRenderings: ["Media", "Navigation", "Page Content", "Page Structure"],
  /**
   * `Headless Variants` children to remove. SXA ships variants for each
   * default rendering; registry-side recipes emit their own variants
   * under `<headlessVariantsRoot>/<section>/<rendering>/<variant>` so
   * the OOTB siblings just clutter the tree.
   */
  headlessVariants: [
    "Image",
    "LinkList",
    "Navigation",
    "PageContent",
    "Promo",
    "RichText",
    "Title",
  ],
  /**
   * `Data` children to remove. SXA seeds these datasource buckets per
   * site; registry recipes carry their own datasources, so the OOTB
   * folders are pure clutter. `Tags` is intentionally omitted —
   * authors populate it during normal content work.
   */
  contentItems: ["Images", "Link Lists", "Navigation Filters", "Promos", "Texts"],
} as const;

export type PruneGroup = keyof typeof DEFAULT_PRUNE_TARGETS;

export type PruneActionStatus = "deleted" | "missing" | "would-delete";

export interface PruneAction {
  group: PruneGroup;
  path: string;
  status: PruneActionStatus;
  itemId?: string;
}

export interface RecipePruneDefaultsOptions extends RecipeTenantOptions {
  /** Override `headlessVariantsRoot` from the env profile. */
  headlessVariantsRoot?: string;
  /** Override `availableRenderingsRoot` from the env profile. */
  availableRenderingsRoot?: string;
  /** Override `contentItemsRoot` from the env profile. */
  contentItemsRoot?: string;
  /** Print the deletions without applying them. */
  whatIf?: boolean;
  /** Bypass the env profile's `allowWrite` gate. */
  allowWrite?: boolean;
}

export interface RecipePruneDefaultsResult {
  environment: string;
  whatIf: boolean;
  actions: PruneAction[];
  summary: { deleted: number; missing: number; wouldDelete: number };
}

const buildTargets = (
  availableRenderingsRoot: string,
  headlessVariantsRoot: string,
  contentItemsRoot: string,
): Array<{ group: PruneGroup; path: string }> => {
  const ar = availableRenderingsRoot.replace(/\/+$/, "");
  const hv = headlessVariantsRoot.replace(/\/+$/, "");
  const ci = contentItemsRoot.replace(/\/+$/, "");
  return [
    ...DEFAULT_PRUNE_TARGETS.availableRenderings.map((name) => ({
      group: "availableRenderings" as const,
      path: `${ar}/${name}`,
    })),
    ...DEFAULT_PRUNE_TARGETS.headlessVariants.map((name) => ({
      group: "headlessVariants" as const,
      path: `${hv}/${name}`,
    })),
    ...DEFAULT_PRUNE_TARGETS.contentItems.map((name) => ({
      group: "contentItems" as const,
      path: `${ci}/${name}`,
    })),
  ];
};

interface PruneCoreOptions {
  client: AuthoringApiClient;
  availableRenderingsRoot: string;
  headlessVariantsRoot: string;
  contentItemsRoot: string;
  whatIf: boolean;
  logger?: Logger;
}

/**
 * Pure(ish) deletion loop — exposed for unit tests so they can drive
 * the deletion contract against a fake `AuthoringApiClient` without
 * threading a full sitecoreai.cli.json through `resolveTenant`.
 */
export const pruneDefaultsAgainstClient = async (
  options: PruneCoreOptions,
): Promise<PruneAction[]> => {
  const { client, availableRenderingsRoot, headlessVariantsRoot, contentItemsRoot, whatIf, logger } = options;
  const targets = buildTargets(availableRenderingsRoot, headlessVariantsRoot, contentItemsRoot);
  const actions: PruneAction[] = [];

  for (const target of targets) {
    const existing = await client.getItem({ path: target.path });
    if (!existing) {
      actions.push({ ...target, status: "missing" });
      logger?.info(`  [skip] ${target.path} — not present`, "gray");
      continue;
    }
    if (whatIf) {
      actions.push({ ...target, status: "would-delete", itemId: existing.itemId });
      logger?.info(`  [dry-run] would delete ${target.path}`, "yellow");
      continue;
    }
    // Delete by itemId — `deleteItem({ path })` works too, but we
    // already have the itemId from the existence check, and itemId
    // selectors avoid Sitecore's leaf-path resolution edge cases.
    await client.deleteItem({ itemId: existing.itemId });
    actions.push({ ...target, status: "deleted", itemId: existing.itemId });
    logger?.info(`  [deleted] ${target.path}`, "green");
  }

  return actions;
};

export const runRecipePruneDefaults = async (
  options: RecipePruneDefaultsOptions,
): Promise<RecipePruneDefaultsResult> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);

  const isDryRun = Boolean(options.whatIf);
  if (!isDryRun) {
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite);
  }

  const headlessVariantsRoot =
    options.headlessVariantsRoot ?? tenant.environment.headlessVariantsRoot;
  const availableRenderingsRoot =
    options.availableRenderingsRoot ?? tenant.environment.availableRenderingsRoot;
  const contentItemsRoot =
    options.contentItemsRoot ?? tenant.environment.contentItemsRoot;
  if (!headlessVariantsRoot || !availableRenderingsRoot || !contentItemsRoot) {
    const missing = [
      !headlessVariantsRoot && "headlessVariantsRoot",
      !availableRenderingsRoot && "availableRenderingsRoot",
      !contentItemsRoot && "contentItemsRoot",
    ]
      .filter(Boolean)
      .join(", ");
    throw createCliError(
      `Recipe prune-defaults missing root path(s): ${missing} not configured for environment '${tenant.envName}'.`,
      "INPUT_INVALID",
      {
        hint: `Add 'headlessVariantsRoot', 'availableRenderingsRoot', and 'contentItemsRoot' to envProfiles.${tenant.envName} in sitecoreai.cli.json (or pass --headless-variants-root / --available-renderings-root / --content-items-root).`,
      },
    );
  }

  if (!logger.isJson()) {
    logger.info(
      `${isDryRun ? "Dry-run prune-defaults" : "Pruning SXA defaults"} on ${tenant.envName}`,
      "cyan",
    );
  }

  const actions = await pruneDefaultsAgainstClient({
    client: tenant.client,
    availableRenderingsRoot,
    headlessVariantsRoot,
    contentItemsRoot,
    whatIf: isDryRun,
    logger: logger.isJson() ? undefined : logger,
  });

  const summary = {
    deleted: actions.filter((a) => a.status === "deleted").length,
    missing: actions.filter((a) => a.status === "missing").length,
    wouldDelete: actions.filter((a) => a.status === "would-delete").length,
  };

  if (logger.isJson()) {
    logger.json({
      command: "recipe.prune-defaults",
      environment: tenant.envName,
      whatIf: isDryRun,
      summary,
      actions,
    });
  } else {
    logger.info(
      `Summary: ${summary.deleted} deleted / ${summary.missing} not present${
        summary.wouldDelete ? ` / ${summary.wouldDelete} would-delete` : ""
      }`,
      summary.deleted > 0 || summary.wouldDelete > 0 ? "green" : "gray",
    );
  }

  return { environment: tenant.envName, whatIf: isDryRun, actions, summary };
};
