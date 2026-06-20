import { Command, Option } from "commander";
import {
  runSitesLanguageAdd,
  runSitesLanguageList,
  runSitesLanguageListSupported,
  runSitesLanguageRemove,
} from "@/sites/tasks/languages";
import {
  addAllowWriteOption,
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  withApplyGate,
} from "../shared";

/** Common env + output options for every language subcommand. */
const addBase = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  return command;
};

export const createSitesLanguageCommand = (): Command => {
  const language = new Command("language")
    .description("Manage the environment's languages (shared by sites + the brand-kit Glossary)")
    .alias("lang");

  const list = new Command("list").description("List languages added to the environment");
  addBase(list);
  list.action(async (options) => runSitesLanguageList(options));

  const listSupported = new Command("list-supported").description(
    "List languages SitecoreAI supports — the catalog you can add from"
  );
  addBase(listSupported);
  listSupported.action(async (options) => runSitesLanguageListSupported(options));

  const add = new Command("add").description(
    "Add a language to the environment (also makes it available to the brand-kit Glossary)"
  );
  addBase(add);
  addAllowWriteOption(add);
  add.addOption(new Option("--code <code>", "Regional ISO code, e.g. fr-FR or da-DK"));
  add.action(async (options) => runSitesLanguageAdd(options));

  const remove = new Command("rm")
    .description("Remove a language from the environment")
    .alias("remove");
  addBase(remove);
  addAllowWriteOption(remove);
  addApplyOption(remove);
  remove.addOption(new Option("--code <code>", "Regional ISO code to remove"));
  remove.action(withApplyGate(runSitesLanguageRemove));

  language.addCommand(list);
  language.addCommand(listSupported);
  language.addCommand(add);
  language.addCommand(remove);
  return language;
};
