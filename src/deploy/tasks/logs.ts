import path from "node:path";
import fs from "node:fs/promises";
import { fetchLogList, fetchLogFile } from "@/deploy/api";
import {
  getDeployContext,
  inputError,
  printDeployResultWithContext,
  resolveDeployEnvironmentId,
  resolveDeployOrganizationId,
  toLogger,
} from "./shared";
import type { DeployLogDataOptions, DeployLogViewOptions, DeployLogsOptions } from "./types";

export const runDeployLogsList = async (options: DeployLogsOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const organizationId = await resolveDeployOrganizationId(context);
  const result = await fetchLogList(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.latest,
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.logs.list", result);
};

export const runDeployLogsView = async (options: DeployLogViewOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.log) {
    throw inputError("Log filename is required. Use --log.");
  }
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const organizationId = await resolveDeployOrganizationId(context);
  const result = await fetchLogFile(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.log,
    false,
    organizationId
  );
  const content = result.buffer.toString("utf8");
  if (logger.isJson()) {
    printDeployResultWithContext(logger, context, "deploy.logs.view", content);
    return;
  }
  logger.info(content);
};

export const runDeployLogsData = async (options: DeployLogDataOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.log) {
    throw inputError("Log filename is required. Use --log.");
  }
  const environmentId = await resolveDeployEnvironmentId(context, options);
  const organizationId = await resolveDeployOrganizationId(context);
  const result = await fetchLogFile(
    { accessToken: context.token, baseUrl: context.baseUrl },
    environmentId,
    options.log,
    true,
    organizationId
  );
  const outputPath = options.output
    ? path.resolve(options.output)
    : path.resolve(process.cwd(), options.log);
  await fs.writeFile(outputPath, result.buffer);
  if (logger.isJson()) {
    printDeployResultWithContext(logger, context, "deploy.logs.data", null, { outputPath });
    return;
  }
  logger.info(`Saved log file to ${outputPath}`, "green");
};
