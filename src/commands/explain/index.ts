import { Command } from "commander";
import { createExplainWhyBlockedCommand } from "./why-blocked";
import { createExplainOrphanSiteCommand } from "./orphan-site";

/**
 * `scai hygiene explain` — read-only verbs that compose existing
 * primitives into focused answers to specific operator questions:
 *
 *   - `why-blocked <itemId>` — what blocks deleting this item
 *     (`audit references` + `audit template-dependencies`).
 *   - `orphan-site <site>`   — what is left behind for a deleted site,
 *     and what still references it (`audit site-residue` +
 *     `audit references`).
 *
 * Each verb owns its printed report; the audits it composes run silent.
 */
export const createExplainCommand = (): Command => {
  const command = new Command("explain").description(
    "Compose multiple audits to answer specific operator questions"
  );
  command.addCommand(createExplainWhyBlockedCommand());
  command.addCommand(createExplainOrphanSiteCommand());
  return command;
};
