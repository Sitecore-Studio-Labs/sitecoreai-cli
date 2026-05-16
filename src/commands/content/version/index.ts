import { Command } from "commander";
import { createInspectCommand } from "./inspect";
import { createSetNeverPublishCommand } from "./set-never-publish";
import { createSetValidityCommand } from "./set-validity";

export const createContentVersionCommand = (): Command => {
  const command = new Command("version").description(
    "Per-version content-state controls. These verbs write CM-side publish-state fields (`__Never publish`, `__Valid from`, `__Valid to`) on a single item version. They do NOT auto-publish — run `scai content publish item` separately to push changes to Edge."
  );

  command.addCommand(createInspectCommand());
  command.addCommand(createSetNeverPublishCommand());
  command.addCommand(createSetValidityCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai content version inspect --path /sitecore/content/Home --language en -n sandbox\n" +
      "  $ scai content version set-never-publish --item-id <guid> --language en --value true -n sandbox\n" +
      "  $ scai content version set-validity --item-id <guid> --language en --valid-to 2026-12-31 -n sandbox\n"
  );
  return command;
};
