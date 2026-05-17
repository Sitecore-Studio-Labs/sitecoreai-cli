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
const CM_CLIENT_ACCOUNT_PREFIX = "cm-client:";
const ORG_CLIENT_ACCOUNT_PREFIX = "org-client:";
const PUBLISHING_ACCOUNT_PREFIX = "publishing:";
const BRIEF_ACCOUNT_PREFIX = "brief:";
const CAMPAIGN_ACCOUNT_PREFIX = "campaign:";
const AGENTS_ACCOUNT_PREFIX = "agents:";
// Brand credential keychain accounts. The string values stay
// `ai-skills-*` on purpose: they are the opaque keychain account keys,
// and changing them would strand secrets stored by older CLI versions
// (forcing a re-login). The constant/function names use `brand`; the
// storage keys are kept stable for back-compat.
const BRAND_SECRET_ACCOUNT_PREFIX = "ai-skills-secret:";
const BRAND_TOKEN_ACCOUNT_PREFIX = "ai-skills-token:";

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
    return await entry.deleteCredential();
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
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

/**
 * The cached Content Operations Brief API token, keyed by Sitecore
 * `organizationId`. The Brief API is org-scoped — one minted token
 * covers every env profile in the organization — so the cache key is
 * the org id, not an env-profile name.
 */
export const getBriefToken = async (orgId: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(BRIEF_ACCOUNT_PREFIX, orgId));
};

export const setBriefToken = async (orgId: string, token: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(BRIEF_ACCOUNT_PREFIX, orgId));
    await entry.setPassword(token);
    return true;
  } catch {
    warnOnce("Unable to write brief token to the OS keychain.", "error");
    return false;
  }
};

export const clearBriefToken = async (orgId: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(BRIEF_ACCOUNT_PREFIX, orgId));
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

export const getCampaignToken = async (envName: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(CAMPAIGN_ACCOUNT_PREFIX, envName));
};

export const setCampaignToken = async (envName: string, token: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CAMPAIGN_ACCOUNT_PREFIX, envName));
    await entry.setPassword(token);
    return true;
  } catch {
    warnOnce("Unable to write campaign token to the OS keychain.", "error");
    return false;
  }
};

export const clearCampaignToken = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CAMPAIGN_ACCOUNT_PREFIX, envName));
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

/**
 * The Agentic Studio browser session for an environment, stored as a
 * JSON-serialized `AgentsCredential` (see `src/agents/session/types.ts`).
 * Unlike the other entries here this is not an OAuth token — Agentic
 * Studio has no machine-credential path yet, so scai captures a browser
 * session cookie instead. Temporary; tracked in that file.
 */
export const getAgentsCredential = async (envName: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(AGENTS_ACCOUNT_PREFIX, envName));
};

export const setAgentsCredential = async (
  envName: string,
  credential: string
): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(AGENTS_ACCOUNT_PREFIX, envName));
    await entry.setPassword(credential);
    return true;
  } catch {
    warnOnce("Unable to write the Agentic Studio session to the OS keychain.", "error");
    return false;
  }
};

export const clearAgentsCredential = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(AGENTS_ACCOUNT_PREFIX, envName));
    return await entry.deleteCredential();
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
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

/**
 * The **secret** of the scai-minted env-scoped automation client for an
 * environment. Stored under a distinct `cm-client:` prefix — separate
 * from the `cm:` token bundle (which holds short-lived access/refresh
 * tokens).
 *
 * Per `docs/credentials.md` the keychain holds only secrets: the
 * client's non-secret metadata (`clientId`, `name`, `mintedAt`) lives in
 * the env profile's `automationClient` block in `sitecoreai.cli.json`.
 * `scai setup client create` writes the metadata to the config and the
 * secret here.
 */
export const getCmClientSecret = async (envName: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(CM_CLIENT_ACCOUNT_PREFIX, envName));
};

export const setCmClientSecret = async (envName: string, secret: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CM_CLIENT_ACCOUNT_PREFIX, envName));
    await entry.setPassword(secret);
    return true;
  } catch {
    warnOnce("Unable to write the CM client secret to the OS keychain.", "error");
    return false;
  }
};

export const clearCmClientSecret = async (envName: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(CM_CLIENT_ACCOUNT_PREFIX, envName));
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

/**
 * The **secret** of the scai-minted **org-level** automation client,
 * keyed by Sitecore `organizationId`. This is the organization-scoped
 * client `scai setup client create --org` provisions (the Deploy clients
 * API `deploy` client type); one per org, shared by every env profile in
 * that org.
 *
 * Per `docs/credentials.md` the keychain holds only secrets: the
 * client's non-secret metadata (`clientId`, `name`, `mintedAt`) lives in
 * the `orgClients[orgId]` block in `sitecoreai.cli.json`.
 */
export const getOrgClientSecret = async (orgId: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(ORG_CLIENT_ACCOUNT_PREFIX, orgId));
};

export const setOrgClientSecret = async (orgId: string, secret: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(ORG_CLIENT_ACCOUNT_PREFIX, orgId));
    await entry.setPassword(secret);
    return true;
  } catch {
    warnOnce("Unable to write the org automation client secret to the OS keychain.", "error");
    return false;
  }
};

export const clearOrgClientSecret = async (orgId: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(ORG_CLIENT_ACCOUNT_PREFIX, orgId));
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

/**
 * Brand credentials are keyed by Sitecore `organizationId`, not by
 * env profile. The AI APIs key is one-org-per-credential (Cloud Portal
 * → Stream → Admin → AI APIs keys), so every env profile in the same
 * org shares one credential. We store the client secret and the cached
 * access token under separate entries to keep their lifecycles
 * independent (token rotates ~daily; secret is long-lived).
 */
export const getBrandClientSecret = async (orgId: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(BRAND_SECRET_ACCOUNT_PREFIX, orgId));
};

export const setBrandClientSecret = async (orgId: string, secret: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(
      SERVICE_NAME,
      makeAccount(BRAND_SECRET_ACCOUNT_PREFIX, orgId)
    );
    await entry.setPassword(secret);
    return true;
  } catch {
    warnOnce("Unable to write Brand client secret to the OS keychain.", "error");
    return false;
  }
};

export const clearBrandClientSecret = async (orgId: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(
      SERVICE_NAME,
      makeAccount(BRAND_SECRET_ACCOUNT_PREFIX, orgId)
    );
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};

export const getBrandToken = async (orgId: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readPassword(ring, makeAccount(BRAND_TOKEN_ACCOUNT_PREFIX, orgId));
};

export const setBrandToken = async (orgId: string, token: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(BRAND_TOKEN_ACCOUNT_PREFIX, orgId));
    await entry.setPassword(token);
    return true;
  } catch {
    warnOnce("Unable to write Brand token to the OS keychain.", "error");
    return false;
  }
};

export const clearBrandToken = async (orgId: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    const entry = new ring.AsyncEntry(SERVICE_NAME, makeAccount(BRAND_TOKEN_ACCOUNT_PREFIX, orgId));
    return await entry.deleteCredential();
  } catch {
    return false;
  }
};
