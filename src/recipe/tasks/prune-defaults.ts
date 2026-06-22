import { createScaiError } from "@/shared/errors";
import { Logger } from "@/shared/logger";
import type { AuthoringApiClient } from "../api/client";
import {
  ensureAllowWrite,
  resolveTenant,
  toLogger,
  withDerivedRecipeRoots,
  type RecipeTenantOptions,
} from "./shared";

/**
 * `scai provision recipe prune-defaults` — remove the SXA Headless OOTB content
 * that ships with every fresh site under `Available Renderings`,
 * `Headless Variants`, the per-site `Data` bucket, and the per-site
 * `Presentation/Styles` bucket. Registry installs ship their own
 * renderings, variants, datasources, and styles; the OOTB folders just
 * noise up the authoring tree. Folder parents are preserved (we keep
 * using `Available Renderings`, `Headless Variants`, `Data`, and
 * `Styles` ourselves) — only the named child folders are removed.
 * `Tags` under `Data` is left alone because authors typically populate
 * it.
 *
 * Idempotent by design: each target is `getItem`-ed first, so a missing
 * path is a clean skip rather than an error. Re-runs after a successful
 * prune produce zero deletions. The deletion call itself also tolerates
 * a "not found" / "may have been deleted by another user" response from
 * the Authoring API — that race shows up when a parallel prune (or an
 * author) removed the item between getItem and deleteItem.
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
  /**
   * `Presentation/Styles` children to remove. SXA seeds a set of
   * default style buckets per site (Spacing, Add Highlight, ...).
   * Registry installs ship their own styles; the OOTB siblings are
   * pure clutter. Names use Title Case to match the literal Sitecore
   * item names — `getItem({ path })` is path-literal, so a casing or
   * spacing mismatch makes the target report as `missing` rather than
   * delete the wrong thing. Adjust on first `--what-if` run if any
   * name doesn't match a real OOTB folder on the target tenant.
   */
  presentationStyles: [
    "Spacing",
    "Add Highlight",
    "Content Alignment",
    "Background Color",
    "Background Layout",
    "Navigation",
    "Link List",
    "Rich Text",
    "Promo",
    "Image",
    "Common",
    "Container",
  ],
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
  /** Override `presentationStylesRoot` from the env profile. */
  presentationStylesRoot?: string;
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
  presentationStylesRoot: string
): Array<{ group: PruneGroup; path: string }> => {
  const ar = availableRenderingsRoot.replace(/\/+$/, "");
  const hv = headlessVariantsRoot.replace(/\/+$/, "");
  const ci = contentItemsRoot.replace(/\/+$/, "");
  const ps = presentationStylesRoot.replace(/\/+$/, "");
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
    ...DEFAULT_PRUNE_TARGETS.presentationStyles.map((name) => ({
      group: "presentationStyles" as const,
      path: `${ps}/${name}`,
    })),
  ];
};

/**
 * Patterns Sitecore Authoring GraphQL uses to report an "item is
 * gone" condition (concurrent delete, stale itemId, never-existed).
 * Treated as a list because Sitecore phrasing varies across versions
 * and operations; extend here when a new variant shows up in the
 * wild. Matched case-insensitively against both the joined error
 * message and any structured `extensions` payload preserved by
 * `shared/graphql.ts`.
 */
const ITEM_NOT_FOUND_PATTERNS: readonly RegExp[] = [
  /was not found/i,
  /may have been deleted by another user/i,
  /item .* (was|is) not found/i,
  /could not be found/i,
  /does not exist/i,
  /no item .* found/i,
];

/**
 * Structured `extensions.code` values that Sitecore (or future
 * passes of this code) may emit for the same condition. Matched
 * against the extension-blob JSON stringified into ScaiError.details.
 */
const ITEM_NOT_FOUND_CODES: readonly string[] = [
  "ITEM_NOT_FOUND",
  "ITEM_NOT_FOUND_ERROR",
  "ItemNotFoundError",
];

/**
 * Detect the Authoring GraphQL "item is gone" response. The shared
 * graphql.ts wrapper joins all error.message strings into a single
 * `Authoring GraphQL errors: <messages>` payload on a NETWORK ScaiError
 * and preserves any GraphQL `extensions` as `details[]`. We prefer the
 * structured signal (code-match against extensions) and fall back to
 * the prose patterns when extensions aren't carried — Sitecore's
 * Authoring GraphQL doesn't reliably emit extension codes today but
 * may in future, and own-error preservation costs nothing.
 */
const isItemNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const scaiError = error as Error & { details?: string[] };
  if (Array.isArray(scaiError.details)) {
    for (const line of scaiError.details) {
      if (ITEM_NOT_FOUND_CODES.some((code) => line.includes(code))) return true;
    }
  }
  return ITEM_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(error.message));
};

interface PruneCoreOptions {
  client: AuthoringApiClient;
  availableRenderingsRoot: string;
  headlessVariantsRoot: string;
  contentItemsRoot: string;
  presentationStylesRoot: string;
  whatIf: boolean;
  logger?: Logger;
}

/**
 * Pure(ish) deletion loop — exposed for unit tests so they can drive
 * the deletion contract against a fake `AuthoringApiClient` without
 * threading a full sitecoreai.cli.json through `resolveTenant`.
 */
export const pruneDefaultsAgainstClient = async (
  options: PruneCoreOptions
): Promise<PruneAction[]> => {
  const {
    client,
    availableRenderingsRoot,
    headlessVariantsRoot,
    contentItemsRoot,
    presentationStylesRoot,
    whatIf,
    logger,
  } = options;
  const targets = buildTargets(
    availableRenderingsRoot,
    headlessVariantsRoot,
    contentItemsRoot,
    presentationStylesRoot
  );
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
    try {
      await client.deleteItem({ itemId: existing.itemId });
      actions.push({ ...target, status: "deleted", itemId: existing.itemId });
      logger?.info(`  [deleted] ${target.path}`, "green");
    } catch (error) {
      // Authoring GraphQL surfaces concurrent-delete as a "was not found"
      // / "may have been deleted by another user" message wrapped in a
      // NETWORK ScaiError. Treat as a clean skip — the post-condition
      // (item gone) is satisfied either way.
      if (isItemNotFoundError(error)) {
        actions.push({ ...target, status: "missing", itemId: existing.itemId });
        logger?.info(`  [skip] ${target.path} — already deleted`, "gray");
        continue;
      }
      throw error;
    }
  }

  return actions;
};

export const runRecipePruneDefaults = async (
  options: RecipePruneDefaultsOptions
): Promise<RecipePruneDefaultsResult> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);

  const isDryRun = Boolean(options.whatIf);
  if (!isDryRun) {
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite);
  }

  // Derive the SXA recipe roots from `site` + `siteCollection` the same way
  // `recipe push`/`pull` do (see push.ts) before reading them. A profile that
  // configures only `site`/`siteCollection` — e.g. the orchestrator's ephemeral
  // CLI config, which stopped writing explicit `*Root` fields — would otherwise
  // fail here as "root path(s) not configured" even though push/pull resolve
  // them fine.
  const env = withDerivedRecipeRoots(tenant.environment) ?? tenant.environment;
  const headlessVariantsRoot = options.headlessVariantsRoot ?? env.headlessVariantsRoot;
  const availableRenderingsRoot = options.availableRenderingsRoot ?? env.availableRenderingsRoot;
  const contentItemsRoot = options.contentItemsRoot ?? env.contentItemsRoot;
  const presentationStylesRoot = options.presentationStylesRoot ?? env.presentationStylesRoot;
  if (
    !headlessVariantsRoot ||
    !availableRenderingsRoot ||
    !contentItemsRoot ||
    !presentationStylesRoot
  ) {
    const missing = [
      !headlessVariantsRoot && "headlessVariantsRoot",
      !availableRenderingsRoot && "availableRenderingsRoot",
      !contentItemsRoot && "contentItemsRoot",
      !presentationStylesRoot && "presentationStylesRoot",
    ]
      .filter(Boolean)
      .join(", ");
    throw createScaiError(
      `Recipe prune-defaults missing root path(s): ${missing} not configured for environment '${tenant.envName}'.`,
      "INPUT_INVALID",
      {
        hint: `Add 'headlessVariantsRoot', 'availableRenderingsRoot', 'contentItemsRoot', and 'presentationStylesRoot' to envProfiles.${tenant.envName} in sitecoreai.cli.json (or pass --headless-variants-root / --available-renderings-root / --content-items-root / --presentation-styles-root).`,
      }
    );
  }

  if (!logger.isJson()) {
    logger.info(
      `${isDryRun ? "Dry-run prune-defaults" : "Pruning SXA defaults"} on ${tenant.envName}`,
      "cyan"
    );
  }

  const actions = await pruneDefaultsAgainstClient({
    client: tenant.client,
    availableRenderingsRoot,
    headlessVariantsRoot,
    contentItemsRoot,
    presentationStylesRoot,
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
      summary.deleted > 0 || summary.wouldDelete > 0 ? "green" : "gray"
    );
  }

  return { environment: tenant.envName, whatIf: isDryRun, actions, summary };
};
