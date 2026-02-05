import { consola } from "consola";

type KeytarModule = typeof import("keytar");

type KeytarLike = KeytarModule & {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

type CmTokenBundle = {
  accessToken?: string;
  refreshToken?: string;
  refreshTokenParameters?: Record<string, string>;
  expiresIn?: number | null;
  lastUpdated?: string | null;
};

const SERVICE_NAME = "SitecoreAI CLI";
const DEPLOY_ACCOUNT_PREFIX = "deploy:";
const CM_ACCOUNT_PREFIX = "cm:";

let cachedKeytar: KeytarLike | null | undefined;
let warnedKeytarUnavailable = false;
let warnedKeytarError = false;

const shouldWarn = (): boolean =>
  process.env.SITECOREAI_JSON !== "1" && process.env.SITECOREAI_QUIET !== "1";

const warnOnce = (message: string, type: "unavailable" | "error"): void => {
  if (!shouldWarn()) {
    return;
  }
  if (type === "unavailable" && warnedKeytarUnavailable) {
    return;
  }
  if (type === "error" && warnedKeytarError) {
    return;
  }
  if (type === "unavailable") {
    warnedKeytarUnavailable = true;
  } else {
    warnedKeytarError = true;
  }
  consola.warn(message);
};

const loadKeytar = async (): Promise<KeytarLike | null> => {
  if (cachedKeytar !== undefined) {
    return cachedKeytar;
  }
  try {
    const mod = (await import("keytar")) as KeytarModule & {
      default?: KeytarLike;
    };
    cachedKeytar = (mod.default ?? mod) as KeytarLike;
    return cachedKeytar;
  } catch {
    cachedKeytar = null;
    warnOnce(
      "Keychain support is unavailable. Tokens will not be stored in the OS keychain.",
      "unavailable"
    );
    return null;
  }
};

const makeAccount = (prefix: string, envName: string): string => `${prefix}${envName}`;

const safeParse = <T>(value: string): T | undefined => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

export const getDeployToken = async (envName: string): Promise<string | undefined> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return undefined;
  }
  try {
    return (
      (await keytar.getPassword(SERVICE_NAME, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName))) ??
      undefined
    );
  } catch {
    warnOnce("Unable to read deploy token from the OS keychain.", "error");
    return undefined;
  }
};

export const setDeployToken = async (envName: string, token: string): Promise<boolean> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }
  try {
    await keytar.setPassword(SERVICE_NAME, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName), token);
    return true;
  } catch {
    warnOnce("Unable to write deploy token to the OS keychain.", "error");
    return false;
  }
};

export const clearDeployToken = async (envName: string): Promise<boolean> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }
  try {
    return await keytar.deletePassword(SERVICE_NAME, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName));
  } catch {
    warnOnce("Unable to delete deploy token from the OS keychain.", "error");
    return false;
  }
};

export const getCmTokens = async (envName: string): Promise<CmTokenBundle | undefined> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return undefined;
  }
  try {
    const raw = await keytar.getPassword(SERVICE_NAME, makeAccount(CM_ACCOUNT_PREFIX, envName));
    if (!raw) {
      return undefined;
    }
    return safeParse<CmTokenBundle>(raw);
  } catch {
    warnOnce("Unable to read CM tokens from the OS keychain.", "error");
    return undefined;
  }
};

export const setCmTokens = async (envName: string, tokens: CmTokenBundle): Promise<boolean> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }
  try {
    await keytar.setPassword(
      SERVICE_NAME,
      makeAccount(CM_ACCOUNT_PREFIX, envName),
      JSON.stringify(tokens)
    );
    return true;
  } catch {
    warnOnce("Unable to write CM tokens to the OS keychain.", "error");
    return false;
  }
};

export const clearCmTokens = async (envName: string): Promise<boolean> => {
  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }
  try {
    return await keytar.deletePassword(SERVICE_NAME, makeAccount(CM_ACCOUNT_PREFIX, envName));
  } catch {
    warnOnce("Unable to delete CM tokens from the OS keychain.", "error");
    return false;
  }
};
