import { Command } from "commander";
import { createSitesLanguageCommand } from "./languages";

/**
 * `scai provision sites` — XM Cloud Sites API operations. Today this
 * surfaces environment-level **language** management (list / add / remove);
 * site CRUD continues to run through the recipe push pipeline.
 */
export const createSitesCommand = (): Command => {
  const sites = new Command("sites").description(
    "XM Cloud Sites API — environment languages (shared by sites + the brand-kit Glossary)"
  );
  sites.addCommand(createSitesLanguageCommand());
  return sites;
};
