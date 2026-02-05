import { Command, Option } from "commander";
import { runDeployLogsList, runDeployLogsView, runDeployLogsData } from "../../serialization/tasks";
import { addDeployBaseOptions } from "./shared";

export const createDeployLogsCommand = (): Command => {
  const logs = new Command("logs").description("Environment log files").alias("log");

  const logsList = new Command("list").description("List environment log files");
  addDeployBaseOptions(logsList);
  logsList
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--latest", "List only the latest logs"));
  logsList.action(async (options) => runDeployLogsList(options));

  const logsView = new Command("view").description("View a log file");
  addDeployBaseOptions(logsView);
  logsView
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--log <filename>", "Log filename"));
  logsView.action(async (options) => runDeployLogsView(options));

  const logsData = new Command("data").description("Download a log file");
  addDeployBaseOptions(logsData);
  logsData
    .addOption(new Option("--id <id>", "Environment ID"))
    .addOption(new Option("--name <name>", "Environment name"))
    .addOption(new Option("--project <value>", "Project name or ID"))
    .addOption(new Option("--log <filename>", "Log filename"))
    .addOption(new Option("--output <path>", "Output file path"));
  logsData.action(async (options) => runDeployLogsData(options));

  logs.addCommand(logsData);
  logs.addCommand(logsList);
  logs.addCommand(logsView);

  return logs;
};
