import { Command } from "commander";
import { runCleanupFieldSet, type FieldSetMode } from "@/hygiene/tasks";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupFieldSetCommand = (): Command => {
  const command = new Command("field-set").description(
    "Bulk-edit one field across a content scope — replace, add (multilist), remove (multilist), clear"
  );

  const apply = new Command("apply").description(
    "Write a value to the named --field across matching items"
  );
  addCleanupBaseOptions(apply);
  apply.requiredOption(
    "--field <name>",
    "Single field name to write (case-insensitive; resolved against the item's template)"
  );
  apply.option(
    "--mode <mode>",
    "How to combine --value with the existing field state. replace (default) | add | remove | clear",
    "replace"
  );
  apply.option(
    "--value <text>",
    "Value to write. For mode=replace: written verbatim. For mode=add/remove: comma- or pipe-separated GUID list. Ignored for mode=clear."
  );
  apply.option(
    "--template-pattern <regex>",
    "Restrict to items whose templateName matches (strongly recommended — without this the verb operates on every item in --root)"
  );
  apply.option(
    "--where-current-matches <regex>",
    "Only update items whose current value of --field matches this regex (e.g. '^$' for empty-only)"
  );
  apply.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  apply.option("--language <code>", "Restrict to one language");
  apply.option("--limit <count>", "Cap on items inspected (default: 5000)", (v) => parseInt(v, 10));
  apply.option(
    "--max-mutations <count>",
    "Maximum number of items to mutate per run (default: 100)",
    (v) => parseInt(v, 10)
  );
  apply.option("--index <name>", "Override the search index name");
  apply.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  apply.option(
    "--include-system-fields",
    "Allow writing to __-prefixed system fields (off by default)"
  );
  apply.option("--cache", "Use the on-disk field cache for the discovery phase");
  apply.addHelpText(
    "after",
    "\nModes:\n" +
      "  replace  Overwrite the field with --value verbatim. Works for any field\n" +
      "           type — caller owns the wire shape (`{guid}`, pipe-list, ISO date,\n" +
      "           <link/> XML).\n" +
      "  add      Union the supplied GUIDs into a pipe-delimited list. Tag-add is\n" +
      "           this mode on a TreelistEx field. Rejects fields whose existing\n" +
      "           value is non-empty and not pipe-delimited.\n" +
      "  remove   Subtract the supplied GUIDs from a pipe-delimited list. Same\n" +
      "           shape guard as add.\n" +
      "  clear    Wipe the field (empty string).\n\n" +
      "Always pair with --template-pattern to scope the run, and start with\n" +
      "--what-if to preview the plan.\n"
  );
  apply.action(async (options) => {
    const mode: FieldSetMode = (options.mode as FieldSetMode) ?? "replace";
    await runCleanupFieldSet({ ...options, mode });
  });

  command.addCommand(apply);
  return command;
};
