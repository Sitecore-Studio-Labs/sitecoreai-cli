import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import fg from "fast-glob";
import {
  fetchDeployments,
  fetchDeployment,
  fetchDeploymentV3,
  fetchDeploymentStatus,
  deployDeployment,
  cancelDeployment,
  uploadDeploymentSource,
  fetchDeploymentLogs,
} from "@/deploy/api";
import { createScaiError } from "@/shared/errors";
import {
  getDeployContext,
  inputError,
  printDeployResultWithContext,
  printDeployWhatIf,
  resolveDeployOrganizationId,
  toLogger,
} from "./shared";
import type {
  DeployBaseOptions,
  DeployDeploymentActionOptions,
  DeployDeploymentLogsOptions,
  DeployDeploymentWatchOptions,
  DeployDeploymentsOptions,
} from "./types";
import { printDeploymentResult } from "./deployment-result";

export const runDeployDeploymentsList = async (
  options: DeployDeploymentsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchDeployments(
    { accessToken: context.token, baseUrl: context.baseUrl },
    {
      status: options.status,
    }
  );
  printDeployResultWithContext(logger, context, "deploy.deployments.list", result);
};

export const runDeployDeploymentsGet = async (options: DeployDeploymentsOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  const result = await fetchDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id
  );
  printDeployResultWithContext(logger, context, "deploy.deployments.get", result);
};

export const runDeployDeploymentsStatus = async (options: DeployBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  const result = await fetchDeploymentStatus(
    { accessToken: context.token, baseUrl: context.baseUrl },
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.deployments.status", result);
};

export const runDeployDeploymentsDeploy = async (
  options: DeployDeploymentsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.deployments.deploy", {
      method: "POST",
      path: `/api/deployments/v1/${options.id}/deploy`,
      organizationId,
    });
    return;
  }
  const result = await deployDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    organizationId
  );
  printDeploymentResult(logger, context, "deploy.deployments.deploy", result);
};

export const runDeployDeploymentsCancel = async (
  options: DeployDeploymentsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.deployments.cancel", {
      method: "POST",
      path: `/api/deployments/v1/${options.id}/cancel`,
      organizationId,
    });
    return;
  }
  const result = await cancelDeployment(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.deployments.cancel", result);
};

export const runDeployDeploymentsWatch = async (
  options: DeployDeploymentWatchOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  const organizationId = await resolveDeployOrganizationId(context);
  const deploymentId = options.id;
  const start = Date.now();
  const timeoutSeconds = Number.isFinite(options.timeout)
    ? Math.max(0, Number(options.timeout))
    : 60 * 60;
  const timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined;
  let lastStatus: string | undefined;
  const isTerminal = (value?: number): boolean => value !== undefined && value >= 2;

  if (options.whatIf) {
    const deployment = await fetchDeploymentV3(
      { accessToken: context.token, baseUrl: context.baseUrl },
      deploymentId,
      organizationId
    );
    printDeployResultWithContext(logger, context, "deploy.deployments.watch", deployment, {
      whatIf: true,
    });
    return;
  }

  while (true) {
    const deployment = (await fetchDeploymentV3(
      { accessToken: context.token, baseUrl: context.baseUrl },
      deploymentId,
      organizationId
    )) as Record<string, unknown>;

    const calculatedStatus =
      typeof deployment.calculatedStatus === "number" ? deployment.calculatedStatus : undefined;
    const deploymentStatus =
      typeof deployment.deploymentStatus === "number" ? deployment.deploymentStatus : undefined;
    const postActionStatus =
      typeof deployment.postActionStatus === "number" ? deployment.postActionStatus : undefined;

    const statusLine = `deploymentStatus=${deploymentStatus ?? "-"} calculatedStatus=${
      calculatedStatus ?? "-"
    } postActionStatus=${postActionStatus ?? "-"}`;
    if (statusLine !== lastStatus) {
      logger.info(statusLine);
      lastStatus = statusLine;
    }

    const done =
      (calculatedStatus !== undefined ? calculatedStatus >= 2 : isTerminal(deploymentStatus)) &&
      (!options.waitForPostActions ||
        postActionStatus === undefined ||
        isTerminal(postActionStatus));

    if (done) {
      printDeployResultWithContext(logger, context, "deploy.deployments.watch", deployment);
      logger.info(`Deployment reached terminal status for ${deploymentId}.`, "green");
      return;
    }

    if (timeoutMs !== undefined && Date.now() - start > timeoutMs) {
      throw createScaiError(
        `Deployment watch timed out after ${timeoutSeconds} seconds.`,
        "DEPLOY_FAILED",
        { hint: "Use --timeout to increase the watch duration." }
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

export const runDeployDeploymentLogs = async (
  options: DeployDeploymentLogsOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  const result = await fetchDeploymentLogs(options.id, context.token);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    if (logger.isJson()) {
      printDeployResultWithContext(logger, context, "deploy.deployments.logs", null, {
        outputPath,
      });
      return;
    }
    logger.info(`Saved deployment logs to ${outputPath}`, "green");
    return;
  }
  printDeployResultWithContext(logger, context, "deploy.deployments.logs", result);
};

export const runDeployDeploymentsSource = async (
  options: DeployDeploymentActionOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!options.id) {
    throw inputError("Deployment ID is required. Use --id.");
  }
  if (options.file && options.directory) {
    throw inputError("Use either --file or --directory, not both.");
  }
  if (!options.file && !options.directory) {
    throw inputError("Source file is required. Use --file or --directory.");
  }
  if (options.whatIf) {
    printDeployWhatIf(logger, context, "deploy.deployments.source", {
      method: "POST",
      path: `/api/deployments/v2/${options.id}/source`,
      source: options.file ?? options.directory,
      contentType: "application/zip",
      organizationId,
    });
    return;
  }
  const sourcePath = path.resolve(options.file ?? options.directory ?? "");
  const stats = await fs.stat(sourcePath);
  let content: Buffer;
  if (options.directory) {
    if (!stats.isDirectory()) {
      throw inputError("Directory path must point to a folder.");
    }
    const zip = new AdmZip();
    const files = await fg(["**/*"], {
      cwd: sourcePath,
      dot: true,
      onlyFiles: true,
    });
    for (const file of files) {
      const entryName = file.split(path.sep).join("/");
      zip.addFile(entryName, await fs.readFile(path.join(sourcePath, file)));
    }
    content = zip.toBuffer();
  } else {
    if (stats.isDirectory()) {
      throw inputError("File path must point to a file. Use --directory to zip a folder.");
    }
    content = await fs.readFile(sourcePath);
  }
  const result = await uploadDeploymentSource(
    { accessToken: context.token, baseUrl: context.baseUrl },
    options.id,
    content,
    "application/zip",
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.deployments.source", result);
};
