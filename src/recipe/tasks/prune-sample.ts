import { Logger } from "@/shared/logger";
import type { AuthoringApiClient } from "../api/client";
import { ensureAllowWrite, resolveTenant, toLogger, type RecipeTenantOptions } from "./shared";

/**
 * `scai provision recipe prune-sample [project]` — delete an SXA sample
 * project's subtrees. A fresh XM Cloud environment ships a large sample
 * (`click-click-launch`) whose templates, branch templates, renderings, and
 * placeholder settings clutter the authoring tree and the Pages component list.
 * This removes the four system subtrees that project occupies, leaving the
 * `Project` / `Placeholder Settings` parents (which your own site lives under)
 * intact.
 *
 * Idempotent: each root is `getItem`-ed first, so a missing path is a clean
 * skip; the delete tolerates a concurrent-delete "not found" race. Destructive —
 * gated on `allowWrite` (and the workspace policy's `destructive` ceiling),
 * with a `--what-if` dry-run.
 */

export const DEFAULT_SAMPLE_PROJECT = "click-click-launch";

export type RecipePruneSampleOptions = RecipeTenantOptions & {
  whatIf?: boolean;
  allowWrite?: boolean;
  /** Sample project name to remove. Defaults to `click-click-launch`. */
  project?: string;
};

export interface PruneSampleAction {
  label: string;
  path: string;
  status: "deleted" | "would-delete" | "missing";
  itemId?: string;
}

/** The four system subtrees an SXA sample project occupies. */
export const sampleProjectRoots = (project: string): { label: string; path: string }[] => [
  { label: "branch templates", path: `/sitecore/templates/Branches/Project/${project}` },
  { label: "templates", path: `/sitecore/templates/Project/${project}` },
  { label: "renderings", path: `/sitecore/layout/Renderings/Project/${project}` },
  { label: "placeholder settings", path: `/sitecore/layout/Placeholder Settings/${project}` },
];

const isItemNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("may have been deleted");
};

/**
 * Pure(ish) deletion loop — exposed so tests can drive the contract against a
 * fake `AuthoringApiClient` without a real tenant.
 */
export const pruneSampleAgainstClient = async (options: {
  client: AuthoringApiClient;
  project: string;
  whatIf: boolean;
  logger?: Logger;
}): Promise<PruneSampleAction[]> => {
  const { client, project, whatIf, logger } = options;
  const actions: PruneSampleAction[] = [];
  for (const target of sampleProjectRoots(project)) {
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
    try {
      await client.deleteItem({ itemId: existing.itemId });
      actions.push({ ...target, status: "deleted", itemId: existing.itemId });
      logger?.info(`  [deleted] ${target.path}`, "green");
    } catch (error) {
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

export const runRecipePruneSample = async (
  options: RecipePruneSampleOptions
): Promise<PruneSampleAction[]> => {
  const logger = toLogger(options);
  const tenant = resolveTenant(options);
  const isDryRun = Boolean(options.whatIf);
  if (!isDryRun) {
    ensureAllowWrite(tenant.root, tenant.envName, options.allowWrite);
  }
  const project = options.project?.trim() || DEFAULT_SAMPLE_PROJECT;

  if (!logger.isJson()) {
    logger.info(
      `${isDryRun ? "Dry-run prune-sample" : "Pruning sample project"} '${project}' on ${tenant.envName}`,
      "cyan"
    );
  }
  const actions = await pruneSampleAgainstClient({
    client: tenant.client,
    project,
    whatIf: isDryRun,
    logger,
  });
  if (logger.isJson()) {
    logger.json({ command: "recipe.prune-sample", project, environment: tenant.envName, actions });
  } else {
    const deleted = actions.filter((a) => a.status === "deleted").length;
    const would = actions.filter((a) => a.status === "would-delete").length;
    logger.info(
      isDryRun ? `Would delete ${would} subtree(s).` : `Deleted ${deleted} subtree(s).`,
      "green"
    );
  }
  return actions;
};
