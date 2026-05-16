import "./setup";
import { describe, it } from "vitest";
import { requestClientCredentialsToken } from "../../src/serialization/api/auth";
import { fetchEnvironments } from "../../src/deploy/api/environments";
import { fetchProjectEnvironments } from "../../src/deploy/api/projects";
import { extractDeployEnvironmentList, getEnvironmentType } from "../../src/deploy/tasks/shared";

export const getEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

const DEFAULT_AUTHORITY = "https://auth.sitecorecloud.io";
const DEFAULT_AUDIENCE = "https://api.sitecorecloud.io";

let cachedDeployToken: string | undefined;

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const describeIfEnv = (required: string[]) => {
  const missing = required.filter((key) => !process.env[key]);
  const describeIf = (name: string, fn: () => void): void => {
    if (missing.length > 0) {
      describe.skip(name, () => {});
      return;
    }
    describe(name, fn);
  };
  return {
    describe: describeIf,
    it: missing.length > 0 ? it.skip : it,
    missing,
  };
};

export const hasDeployAuth = (): boolean => {
  if (getEnv("SITECOREAI_DEPLOY_TOKEN")) {
    return true;
  }
  return Boolean(getEnv("SITECOREAI_CLIENT_ID") && getEnv("SITECOREAI_CLIENT_SECRET"));
};

export const describeIfDeployAuth = () => {
  const missing: string[] = [];
  if (process.env.SITECOREAI_RUN_INTEGRATION !== "1") {
    missing.push("SITECOREAI_RUN_INTEGRATION=1");
  }
  if (!hasDeployAuth()) {
    missing.push("SITECOREAI_DEPLOY_TOKEN or SITECOREAI_CLIENT_ID/SECRET");
  }
  return {
    describe: missing.length > 0 ? describe.skip : describe,
    it: missing.length > 0 ? it.skip : it,
    missing,
  };
};

export const resolveDeployToken = async (): Promise<string> => {
  if (cachedDeployToken) {
    return cachedDeployToken;
  }
  const fromEnv = getEnv("SITECOREAI_DEPLOY_TOKEN");
  if (fromEnv) {
    cachedDeployToken = fromEnv;
    return fromEnv;
  }
  const clientId = getEnv("SITECOREAI_CLIENT_ID");
  const clientSecret = getEnv("SITECOREAI_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "Deploy token is required. Set SITECOREAI_DEPLOY_TOKEN or SITECOREAI_CLIENT_ID/SECRET."
    );
  }
  const authority = getEnv("SITECOREAI_AUTHORITY") ?? DEFAULT_AUTHORITY;
  const audience = getEnv("SITECOREAI_AUDIENCE") ?? DEFAULT_AUDIENCE;
  const token = await requestClientCredentialsToken({
    authority,
    clientId,
    clientSecret,
    audience,
  });
  cachedDeployToken = token.accessToken;
  return token.accessToken;
};

export const resolveEnvironmentId = async (
  accessToken: string,
  baseUrl?: string,
  projectId?: string
): Promise<string | undefined> => {
  try {
    const result = projectId
      ? await fetchProjectEnvironments({ accessToken, baseUrl }, projectId)
      : await fetchEnvironments({ accessToken, baseUrl });
    const list = extractDeployEnvironmentList(result);
    if (list.length === 0) {
      return undefined;
    }
    const cmEnvironments = list.filter((environment) => {
      const type = getEnvironmentType(environment);
      return type ? type.toLowerCase().includes("cm") : false;
    });
    const selection = (cmEnvironments.length > 0 ? cmEnvironments : list)[0];
    if (!selection) {
      return undefined;
    }
    return selection.id ?? selection.environmentId;
  } catch {
    return undefined;
  }
};
