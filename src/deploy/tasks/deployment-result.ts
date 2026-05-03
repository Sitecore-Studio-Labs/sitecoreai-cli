import { Logger } from "@/shared/logger";
import { printDeployResult, printDeployResultWithContext } from "./shared";

export const resolveDeploymentId = (result: unknown): string | undefined => {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as { deploymentId?: unknown; id?: unknown; location?: unknown };
  if (typeof record.deploymentId === "string") {
    return record.deploymentId;
  }
  if (typeof record.id === "string") {
    return record.id;
  }
  if (typeof record.location === "string") {
    return record.location.split("/").filter(Boolean).pop();
  }
  return undefined;
};

export const printDeploymentResult = (
  logger: Logger,
  context: { envName?: string },
  command: string,
  result: unknown
): string | undefined => {
  const deploymentId = resolveDeploymentId(result);
  if (logger.isJson()) {
    printDeployResultWithContext(logger, context, command, result, {
      deploymentId: deploymentId ?? null,
    });
    return deploymentId;
  }
  printDeployResult(logger, result);
  if (deploymentId) {
    logger.info(`Deployment ID: ${deploymentId}`, "cyan");
  }
  return deploymentId;
};
