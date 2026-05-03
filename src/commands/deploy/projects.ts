import { Command, Option } from "commander";
import {
  runDeployProjectsList,
  runDeployProjectsLimitation,
  runDeployProjectsValidateName,
  runDeployProjectsGet,
  runDeployProjectsCreate,
  runDeployProjectsUpdate,
  runDeployProjectsLinkRepository,
  runDeployProjectsUnlinkRepository,
  runDeployProjectsDelete,
} from "@/deploy/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeployProjectsCommand = (): Command => {
  const projects = new Command("projects").description("Project operations").alias("proj");

  const projectsList = new Command("list").description("List projects");
  addDeployBaseOptions(projectsList);
  projectsList.action(async (options) => runDeployProjectsList(options));

  const projectsLimitation = new Command("limitation").description("Get project limitations");
  addDeployBaseOptions(projectsLimitation);
  projectsLimitation.action(async (options) => runDeployProjectsLimitation(options));

  const projectsValidateName = new Command("validate-name").description(
    "Validate that a project name is unique"
  );
  addDeployBaseOptions(projectsValidateName);
  projectsValidateName.addOption(new Option("--name <name>", "Project name"));
  projectsValidateName.action(async (options) => runDeployProjectsValidateName(options));

  const projectsGet = new Command("get").description("Get a project by name or ID");
  addDeployBaseOptions(projectsGet);
  projectsGet
    .addOption(new Option("--id <id>", "Project ID"))
    .addOption(new Option("--name <name>", "Project name"));
  projectsGet.action(async (options) => runDeployProjectsGet(options));

  const projectsCreate = new Command("create").description("Create a project");
  addDeployBaseOptions(projectsCreate);
  projectsCreate
    .addOption(new Option("--name <name>", "Project name"))
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--repository-id <id>", "Repository ID"))
    .addOption(
      new Option(
        "--source-control-integration-id <id>",
        "Source control integration ID (maps to integrationId)"
      )
    );
  projectsCreate.action(async (options) => runDeployProjectsCreate(options));

  const projectsUpdate = new Command("update").description("Update a project by name or ID");
  addDeployBaseOptions(projectsUpdate);
  projectsUpdate
    .addOption(new Option("--id <id>", "Project ID"))
    .addOption(new Option("--name <name>", "Project name"))
    .addOption(new Option("--new-name <name>", "New project name"))
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--repository-id <id>", "Repository ID"))
    .addOption(
      new Option(
        "--source-control-integration-id <id>",
        "Source control integration ID (maps to sourceControlIntegrationId)"
      )
    );
  projectsUpdate.action(async (options) => runDeployProjectsUpdate(options));

  const projectsLinkRepository = new Command("link-repository").description(
    "Link a repository to a project"
  );
  addDeployBaseOptions(projectsLinkRepository);
  projectsLinkRepository
    .addOption(new Option("--id <id>", "Project ID"))
    .addOption(new Option("--repository-name <name>", "Repository name"))
    .addOption(new Option("--repository-id <id>", "Repository ID"))
    .addOption(new Option("--integration-id <id>", "Integration ID"))
    .addOption(new Option("--repository-relative-path <path>", "Repository relative path"));
  projectsLinkRepository.action(async (options) => runDeployProjectsLinkRepository(options));

  const projectsUnlinkRepository = new Command("unlink-repository").description(
    "Unlink a repository from a project"
  );
  addDeployBaseOptions(projectsUnlinkRepository);
  projectsUnlinkRepository.addOption(new Option("--id <id>", "Project ID"));
  projectsUnlinkRepository.action(async (options) => runDeployProjectsUnlinkRepository(options));

  const projectsDelete = new Command("delete").description("Delete a project by name or ID");
  addDeployBaseOptions(projectsDelete);
  projectsDelete
    .addOption(new Option("--id <id>", "Project ID"))
    .addOption(new Option("--name <name>", "Project name"))
    .addOption(new Option("--force", "Skip confirmation prompt"));
  projectsDelete.action(async (options) => runDeployProjectsDelete(options));

  projects.addCommand(projectsCreate);
  projects.addCommand(projectsDelete);
  projects.addCommand(projectsGet);
  projects.addCommand(projectsLimitation);
  projects.addCommand(projectsLinkRepository);
  projects.addCommand(projectsList);
  projects.addCommand(projectsUnlinkRepository);
  projects.addCommand(projectsUpdate);
  projects.addCommand(projectsValidateName);

  return projects;
};
