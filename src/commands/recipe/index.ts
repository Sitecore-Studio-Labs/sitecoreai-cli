import { Command, Option } from "commander";
import {
  addAllowWriteOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
} from "../shared";
import { runRecipeCompile, runRecipePlan, runRecipePush } from "../../recipe/tasks";

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

// Both flags are optional. Falls back to envProfiles[<name>].templatesRoot
// / .renderingsRoot in sitecoreai.cli.json. resolveRecipeRoots() throws
// `INPUT_INVALID` with a config-shape hint if neither source is set.
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

const createPlanCommand = (): Command => {
  const command = new Command("plan").description(
    "Plan an Operation IR push against a tenant — read-then-diff, no mutations"
  );

  addRequiredInputOption(command, "Path to a compiled .ir.json file");
  addOutputOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runRecipePlan(options);
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
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runRecipePush(options);
  });
  return command;
};

export const createRecipeCommand = (): Command => {
  const command = new Command("recipe").description(
    "Compile, plan, and push declarative recipes to Sitecore"
  );

  command.addCommand(createCompileCommand());
  command.addCommand(createPlanCommand());
  command.addCommand(createPushCommand());

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  # Compile a single recipe to IR",
      "  $ scai recipe compile -i ./recipes/cta-button.recipe.ts \\",
      '      --templates-root "/sitecore/templates/Project/my-site/Components" \\',
      '      --renderings-root "/sitecore/layout/Renderings/Project/my-site"',
      "",
      "  # Plan against a tenant from a pre-compiled IR",
      "  $ scai recipe plan -i ./recipes/.scai/cta-button_v1.ir.json -n my-tenant",
      "",
      "  # Push every recipe in the config glob (default `recipes/**/*.recipe.ts`)",
      "  $ scai recipe push -n my-tenant --what-if",
      "  $ scai recipe push -n my-tenant --allow-write",
      "",
      "  # Push a single recipe explicitly",
      "  $ scai recipe push -i ./recipes/cta-button.recipe.ts -n my-tenant --allow-write",
    ].join("\n")
  );

  return command;
};
