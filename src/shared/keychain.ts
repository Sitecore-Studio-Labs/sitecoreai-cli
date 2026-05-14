import { consola } from "consola";

/**
 * OS keychain access via `@napi-rs/keyring` (Rust-based, actively maintained,
 * prebuilt binaries). Replaces `keytar`, whose upstream `atom/node-keytar`
 * was archived when Atom shut down in Dec 2022.
 *
 * The wrapper preserves the original async public API so callers (auth, init,
 * logout, deploy-token, etc.) don't need to change. Internally we use
 * `AsyncEntry` from `@napi-rs/keyring`, which mirrors the keyring-rs crate's
 * platform behavior (macOS Keychain, Windows Credential Manager, libsecret).
 *
 * Fail-closed semantics: if the native module fails to load (e.g. CI runners
 * without a keychain backend), every operation returns undefined/false with
 * a one-shot warning. No plaintext disk fallback — callers fall back to
 * SITECOREAI_* env vars in those environments.
 */

type KeyringModule = typeof import("@napi-rs/keyring");

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
const PUBLISHING_ACCOUNT_PREFIX = "publishing:";

let cachedKeyring: KeyringModule | null | undefined;
let warnedKeyringUnavailable = false;
let warnedKeyringError = false;

const shouldWarn = (): boolean =>
  process.env.SITECOREAI_JSON !== "1" && process.env.SITECOREAI_QUIET !== "1";

const warnOnce = (message: string, type: "unavailable" | "error"): void => {
  if (!shouldWarn()) {
    return;
  }
  if (type === "unavailable" && warnedKeyringUnavailable) {
    return;
  }
  if (type === "error" && warnedKeyringError) {
    return;
  }
  if (type === "unavailable") {
    warnedKeyringUnavailable = true;
  } else {
    warnedKeyringError = true;
  }
  consola.warn(message);
};

const loadKeyring = async (): Promise<KeyringModule | null> => {
  if (cachedKeyring !== undefined) {
    return cachedKeyring;
  }
  try {
    const mod = (await import("@napi-rs/keyring")) as KeyringModule & {
      default?: KeyringModule;
    };
    // CJS interop: @napi-rs/keyring is CJS so dynamic import wraps the
    // exports under `default` on some Node versions. Try the namespace
    // first (has AsyncEntry as a named export), fall back to default.
    cachedKeyring = (mod.AsyncEntry ? mod : (mod.default ?? mod)) as KeyringModule;
    return cachedKeyring;
  } catch {
    cachedKeyring = null;
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

/**
 * Treat any read failure as "no token stored" — `@napi-rs/keyring` throws
 * a NoEntry error when the credential doesn't exist (vs keytar which returned
 * null). Distinguishing NoEntry from real errors requires platform-specific
 * inspection; the conservative choice is to return undefined silently and
 * surface real failures the next time a set/delete is attempted.
 */
const readPassword = async (ring: KeyringModule, account: string): Promise<string | undefined> => {
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, account);
    return (await entry.getPassword()) ?? undefined;
  } catch {
    return undefined;
  }
};

export const getDeployToken = async (envName: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName));
};

export const setDeployToken = async (envName: string, token: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName));
    await entry.setPassword(token);
    return true;
  } catch {
    warnOnce("Unable to write deploy token to the OS keychain.", "error");
    return false;
  }
};

export const clearDeployToken = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(DEPLOY_ACCOUNT_PREFIX, envName));
    return entry.deleteCredential();
  } catch {
    // NoEntry on delete is idempotent success; other errors warn.
    return false;
  }
};

export const getPublishingToken = async (envName: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(PUBLISHING_ACCOUNT_PREFIX, envName));
};

export const setPublishingToken = async (envName: string, token: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(
      SERVICE_NAME,
      makeAccount(PUBLISHING_ACCOUNT_PREFIX, envName)
    );
    await entry.setPassword(token);
    return true;
  } catch {
    warnOnce("Unable to write publishing token to the OS keychain.", "error");
    return false;
  }
};

export const clearPublishingToken = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(
      SERVICE_NAME,
      makeAccount(PUBLISHING_ACCOUNT_PREFIX, envName)
    );
    return entry.deleteCredential();
  } catch {
    return false;
  }
};

export const getCmTokens = async (envName: string): Promise<CmTokenBundle | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  const raw = await readPassword(ring, makeAccount(CM_ACCOUNT_PREFIX, envName));
  if (!raw) {
    return undefined;
  }
  return safeParse<CmTokenBundle>(raw);
};

export const setCmTokens = async (envName: string, tokens: CmTokenBundle): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CM_ACCOUNT_PREFIX, envName));
    await entry.setPassword(JSON.stringify(tokens));
    return true;
  } catch {
    warnOnce("Unable to write CM tokens to the OS keychain.", "error");
    return false;
  }
};

export const clearCmTokens = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CM_ACCOUNT_PREFIX, envName));
    return entry.deleteCredential();
  } catch {
    return false;
  }
};
