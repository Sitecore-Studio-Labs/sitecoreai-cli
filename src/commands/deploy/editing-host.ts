import { Command, Option } from "commander";
import {
  runDeployEditingHostList,
  runDeployEditingHostCreate,
  runDeployEditingHostDelete,
  runDeployEditingHostUpdate,
  runDeployEditingHostDeploy,
} from "@/deploy/tasks/editing-host";
import { withApplyGate } from "../shared";
import { addDeployBaseOptions } from "./shared";

const parsePositiveInt =
  (label: string) =>
  (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
  };

export const createDeployEditingHostCommand = (): Command => {
  const editingHost = new Command("editing-host")
    .description("Editing host operations")
    .alias("eh");

  const list = new Command("list").description("List editing host environments");
  addDeployBaseOptions(list);
  list
    .addOption(new Option("--project <value>", "Project name or ID (Deploy API)"))
    .addOption(
      new Option(
        "--no-all",
        "Return only one page of environments before filtering (default: walk every page)"
      )
    )
    .addOption(
      new Option("--page <n>", "1-based page number; implies --no-all").argParser(
        parsePositiveInt("--page")
      )
    )
    .addOption(
      new Option(
        "--page-size <n>",
        "Page size. Defaults to 50 when walking, otherwise the API default (10)."
      ).argParser(parsePositiveInt("--page-size"))
    );
  list.action(async (options) => runDeployEditingHostList(options));

  const create = new Command("create").description("Create an editing host environment");
  addDeployBaseOptions(create);
  create
    .addOption(new Option("--cm-environment-id <id>", "CM environment ID"))
    .addOption(new Option("--name <name>", "Editing host name"));
  create.action(async (options) => runDeployEditingHostCreate(options));

  const update = new Command("update").description("Update an editing host environment");
  addDeployBaseOptions(update);
  update
    .addOption(new Option("--id <id>", "Editing host environment ID"))
    .addOption(new Option("--name <name>", "Editing host name"));
  update.action(async (options) => runDeployEditingHostUpdate(options));

  const del = new Command("delete").description("Delete an editing host environment");
  addDeployBaseOptions(del);
  del
    .addOption(new Option("--id <id>", "Editing host environment ID"))
    .addOption(new Option("--force", "Force delete environment"));
  del.action(withApplyGate(runDeployEditingHostDelete));

  const deploy = new Command("deploy").description("Deploy an editing host environment");
  addDeployBaseOptions(deploy);
  deploy
    .addOption(new Option("--id <id>", "Editing host environment ID"))
    .addOption(new Option("--redeploy", "Deploy using the existing linked source code"))
    .addOption(new Option("--no-watch", "Do not watch deployment progress"))
    .addOption(new Option("--wait-for-post-actions", "Wait for post-actions to complete"))
    .addOption(
      new Option("--timeout <seconds>", "Timeout in seconds before exiting watch").argParser(Number)
    );
  deploy.action(async (options) => runDeployEditingHostDeploy(options));

  editingHost.addCommand(create);
  editingHost.addCommand(del);
  editingHost.addCommand(deploy);
  editingHost.addCommand(list);
  editingHost.addCommand(update);

  return editingHost;
};
