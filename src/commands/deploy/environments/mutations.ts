import { Command, Option } from "commander";
import {
  runDeployEnvironmentsCreate,
  runDeployEnvironmentsRegenerateContext,
  runDeployEnvironmentsPromote,
  runDeployEnvironmentsRestartStatus,
  runDeployEnvironmentsRestart,
  runDeployEnvironmentsLinkRepository,
  runDeployEnvironmentsUnlinkRepository,
  runDeployEnvironmentsDelete,
} from "@/deploy/tasks/environments";
import { withApplyGate } from "../../shared";
import { addDeployBaseOptions } from "../shared";

export const createEnvironmentsCreateCommand = (): Command => {
  const environmentsCreate = new Command("create").description("Create an environment");
  addDeployBaseOptions(environmentsCreate);
  environmentsCreate
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(
      new Option("--tenant-type <number>", "Tenant type (0 = nonprod, 1 = prod)").argParser(Number)
    )
    .addOption(new Option("--cm-only", "Create a CM-only environment"));
  environmentsCreate.action(async (options) => runDeployEnvironmentsCreate(options));
  return environmentsCreate;
};

export const createEnvironmentsRegenerateContextCommand = (): Command => {
  const environmentsRegenerateContext = new Command("regenerate-context").description(
    "Regenerate environment context"
  );
  addDeployBaseOptions(environmentsRegenerateContext);
  environmentsRegenerateContext
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsRegenerateContext.action(async (options) =>
    runDeployEnvironmentsRegenerateContext(options)
  );
  return environmentsRegenerateContext;
};

export const createEnvironmentsPromoteCommand = (): Command => {
  const environmentsPromote = new Command("promote").description(
    "Promote a deployment to this environment"
  );
  addDeployBaseOptions(environmentsPromote);
  environmentsPromote
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--source-id <id>", "Source deployment ID"))
    .addOption(new Option("--no-start", "Do not start the promoted deployment"))
    .addOption(new Option("--no-watch", "Do not watch deployment progress"))
    .addOption(new Option("--wait-for-post-actions", "Wait for post-actions to complete"))
    .addOption(
      new Option("--timeout <seconds>", "Timeout in seconds before exiting watch").argParser(Number)
    );
  environmentsPromote.action(async (options) => runDeployEnvironmentsPromote(options));
  return environmentsPromote;
};

export const createEnvironmentsRestartCommand = (): Command => {
  const environmentsRestart = new Command("restart").description("Restart an environment");
  addDeployBaseOptions(environmentsRestart);
  environmentsRestart
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--force", "Skip confirmation prompt"))
    .option("--status", "Get restart status instead of triggering a restart");
  environmentsRestart.action(async (options) => {
    if (options.status) {
      await runDeployEnvironmentsRestartStatus(options);
      return;
    }
    await runDeployEnvironmentsRestart(options);
  });
  return environmentsRestart;
};

export const createEnvironmentsLinkRepositoryCommand = (): Command => {
  const environmentsLinkRepository = new Command("link-repository").description(
    "Link a repository to an environment"
  );
  addDeployBaseOptions(environmentsLinkRepository);
  environmentsLinkRepository
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--repository-id <id>", "Repository ID"))
    .addOption(new Option("--integration-id <id>", "Integration ID"))
    .addOption(new Option("--repository-relative-path <path>", "Repository relative path"))
    .addOption(new Option("--repository-branch <name>", "Repository branch"));
  environmentsLinkRepository.action(async (options) =>
    runDeployEnvironmentsLinkRepository(options)
  );
  return environmentsLinkRepository;
};

export const createEnvironmentsUnlinkRepositoryCommand = (): Command => {
  const environmentsUnlinkRepository = new Command("unlink-repository").description(
    "Unlink a repository from an environment"
  );
  addDeployBaseOptions(environmentsUnlinkRepository);
  environmentsUnlinkRepository
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"));
  environmentsUnlinkRepository.action(withApplyGate(runDeployEnvironmentsUnlinkRepository));
  return environmentsUnlinkRepository;
};

export const createEnvironmentsDeleteCommand = (): Command => {
  const environmentsDelete = new Command("delete").description(
    "Delete an environment by name or ID"
  );
  addDeployBaseOptions(environmentsDelete);
  environmentsDelete
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--force", "Force delete environment"));
  environmentsDelete.action(withApplyGate(runDeployEnvironmentsDelete));
  return environmentsDelete;
};
