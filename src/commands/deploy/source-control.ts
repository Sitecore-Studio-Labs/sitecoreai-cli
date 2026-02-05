import { Command, Option } from "commander";
import {
  runDeploySourceControlList,
  runDeploySourceControlState,
  runDeploySourceControlAccessToken,
  runDeploySourceControlValidate,
  runDeploySourceControlTemplates,
  runDeploySourceControlRepositoryGet,
  runDeploySourceControlRepositoryBranches,
  runDeploySourceControlRepositoryValidate,
  runDeploySourceControlRepositoryCreateFromTemplate,
  runDeploySourceControlProviders,
  runDeploySourceControlGet,
  runDeploySourceControlDelete,
} from "../../serialization/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeploySourceControlCommand = (): Command => {
  const sourceControl = new Command("source-control")
    .description("Source control operations")
    .alias("sc");

  const sourceControlList = new Command("list").description("List source control integrations");
  addDeployBaseOptions(sourceControlList);
  sourceControlList.action(async (options) => runDeploySourceControlList(options));

  const sourceControlState = new Command("state").description("Get OAuth state for integration");
  addDeployBaseOptions(sourceControlState);
  sourceControlState.action(async (options) => runDeploySourceControlState(options));

  const sourceControlAccessToken = new Command("access-token").description(
    "Get source control integration access token"
  );
  addDeployBaseOptions(sourceControlAccessToken);
  sourceControlAccessToken.addOption(new Option("--id <id>", "Integration ID"));
  sourceControlAccessToken.action(async (options) => runDeploySourceControlAccessToken(options));

  const sourceControlValidate = new Command("validate").description(
    "Validate source control integration"
  );
  addDeployBaseOptions(sourceControlValidate);
  sourceControlValidate.addOption(new Option("--id <id>", "Integration ID"));
  sourceControlValidate.action(async (options) => runDeploySourceControlValidate(options));

  const sourceControlRepository = new Command("repository").description(
    "Source control repository operations"
  );
  const sourceControlRepositoryGet = new Command("get").description(
    "Get source control repository"
  );
  addDeployBaseOptions(sourceControlRepositoryGet);
  sourceControlRepositoryGet
    .addOption(new Option("--integration-id <id>", "Integration ID"))
    .addOption(new Option("--repository-id <id>", "Repository ID"));
  sourceControlRepositoryGet.action(async (options) =>
    runDeploySourceControlRepositoryGet(options)
  );

  const sourceControlRepositoryBranches = new Command("branches").description(
    "List repository branches"
  );
  addDeployBaseOptions(sourceControlRepositoryBranches);
  sourceControlRepositoryBranches
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--integration-id <id>", "Integration ID"));
  sourceControlRepositoryBranches.action(async (options) =>
    runDeploySourceControlRepositoryBranches(options)
  );

  const sourceControlRepositoryValidate = new Command("validate").description(
    "Validate source control repository"
  );
  addDeployBaseOptions(sourceControlRepositoryValidate);
  sourceControlRepositoryValidate
    .addOption(new Option("--integration-id <id>", "Integration ID"))
    .addOption(new Option("--repository-name <name>", "Repository name"));
  sourceControlRepositoryValidate.action(async (options) =>
    runDeploySourceControlRepositoryValidate(options)
  );

  const sourceControlRepositoryCreateFromTemplate = new Command("create-from-template").description(
    "Create repository from template"
  );
  addDeployBaseOptions(sourceControlRepositoryCreateFromTemplate);
  sourceControlRepositoryCreateFromTemplate
    .addOption(new Option("--provider <name>", "Provider (ado or github)"))
    .addOption(new Option("--template-repository <name>", "Template repository name"))
    .addOption(new Option("--template-owner <name>", "Template repository owner"))
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--owner <name>", "Repository owner"))
    .addOption(new Option("--integration-id <id>", "Integration ID"))
    .addOption(new Option("--description <text>", "Repository description"))
    .addOption(new Option("--private-repository", "Create a private repository"))
    .addOption(new Option("--no-private-repository", "Create a public repository"))
    .addOption(new Option("--include-all-branches", "Include all branches from template"))
    .addOption(new Option("--no-include-all-branches", "Exclude non-default branches"));
  sourceControlRepositoryCreateFromTemplate.action(async (options) =>
    runDeploySourceControlRepositoryCreateFromTemplate(options)
  );

  sourceControlRepository.addCommand(sourceControlRepositoryBranches);
  sourceControlRepository.addCommand(sourceControlRepositoryCreateFromTemplate);
  sourceControlRepository.addCommand(sourceControlRepositoryGet);
  sourceControlRepository.addCommand(sourceControlRepositoryValidate);

  const sourceControlProviders = new Command("providers").description(
    "List source control providers"
  );
  addDeployBaseOptions(sourceControlProviders);
  sourceControlProviders.action(async (options) => runDeploySourceControlProviders(options));

  const sourceControlTemplates = new Command("templates").description(
    "List source control templates"
  );
  addDeployBaseOptions(sourceControlTemplates);
  sourceControlTemplates.addOption(new Option("--provider <name>", "Provider (ado or github)"));
  sourceControlTemplates.action(async (options) => runDeploySourceControlTemplates(options));

  const sourceControlGet = new Command("get").description("Get a source control integration");
  addDeployBaseOptions(sourceControlGet);
  sourceControlGet.addOption(new Option("--id <id>", "Integration ID"));
  sourceControlGet.action(async (options) => runDeploySourceControlGet(options));

  const sourceControlDelete = new Command("delete").description(
    "Delete a source control integration"
  );
  addDeployBaseOptions(sourceControlDelete);
  sourceControlDelete.addOption(new Option("--id <id>", "Integration ID"));
  sourceControlDelete.action(async (options) => runDeploySourceControlDelete(options));

  sourceControl.addCommand(sourceControlAccessToken);
  sourceControl.addCommand(sourceControlDelete);
  sourceControl.addCommand(sourceControlGet);
  sourceControl.addCommand(sourceControlList);
  sourceControl.addCommand(sourceControlProviders);
  sourceControl.addCommand(sourceControlRepository);
  sourceControl.addCommand(sourceControlState);
  sourceControl.addCommand(sourceControlTemplates);
  sourceControl.addCommand(sourceControlValidate);

  return sourceControl;
};
