import { consola } from "consola";

import { redactSecrets } from "./redact";

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
 *
 * Chunking: Windows Credential Manager caps a single credential blob at
 * `CRED_MAX_CREDENTIAL_BLOB_SIZE` = 2560 bytes, and keyring-rs stores the
 * password UTF-16-encoded there — so the real budget is ~1280 UTF-16 code
 * units. A Sitecore access token (a JWT carrying several scope claims)
 * routinely exceeds that, which made deploy-token writes silently fail on
 * Windows. Any value too large for one blob is transparently split across
 * companion `<account>#chunk<i>` entries with a small manifest in the
 * primary account; `readSecret` reassembles them. macOS Keychain and
 * libsecret have far larger limits, but chunking is applied uniformly so
 * behavior doesn't diverge by platform. Values that fit are written verbatim
 * — credentials written by older CLI versions still read back unchanged.
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

/**
 * Max UTF-16 code units written to a single keychain blob. 1024 units =
 * 2048 bytes UTF-16, leaving headroom under the Windows Credential Manager
 * 2560-byte `CRED_MAX_CREDENTIAL_BLOB_SIZE` limit. A JS string's `.length`
 * is already its UTF-16 code-unit count, so chunk sizing is exact.
 */
const CHUNK_SIZE = 1024;
/**
 * Sentinel stored in the primary account when a value is chunked; the chunk
 * count follows. The leading NUL guarantees it can't collide with a real
 * stored value — JWTs, JSON bundles, and OAuth secrets never contain NUL.
 */
const CHUNK_MARKER = "\u0000scai-keychain-chunked-v1\u0000";

const chunkAccount = (account: string, index: number): string => `${account}#chunk${index}`;

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

/**
 * Turn an error thrown by the keyring into a concise, redacted reason
 * string. The previous `catch {}` blocks discarded this entirely, which is
 * why a Windows Credential Manager rejection (e.g. an over-limit blob)
 * surfaced only as a generic "unable to write" with no diagnosable cause.
 */
const describeKeyringError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return typeof error === "string" ? redactSecrets(error) : "";
  }
  const code = (error as { code?: unknown }).code;
  const text =
    typeof code === "string" && code.length > 0 ? `${code}: ${error.message}` : error.message;
  return redactSecrets(text);
};

const withReason = (message: string, error: unknown): string => {
  const reason = describeKeyringError(error);
  return reason ? `${message} (${reason})` : message;
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

const entryFor = (
  ring: KeyringModule,
  account: string
): InstanceType<KeyringModule["AsyncEntry"]> => new ring.AsyncEntry(SERVICE_NAME, account);

/**
 * Read a single account's blob. `@napi-rs/keyring` throws a NoEntry error
 * when the credential doesn't exist (vs keytar which returned null).
 * Distinguishing NoEntry from real errors requires platform-specific
 * inspection; the conservative choice is to return undefined silently and
 * surface real failures the next time a set/delete is attempted.
 */
const readPassword = async (ring: KeyringModule, account: string): Promise<string | undefined> => {
  try {
    return (await entryFor(ring, account).getPassword()) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Number of chunks a primary blob references, or 0 if it isn't a manifest. */
const chunkCountOf = (primary: string | undefined): number => {
  if (primary === undefined || !primary.startsWith(CHUNK_MARKER)) {
    return 0;
  }
  const count = Number.parseInt(primary.slice(CHUNK_MARKER.length), 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
};

/** Delete chunk entries `[from, count)` for an account, ignoring NoEntry. */
const deleteChunks = async (
  ring: KeyringModule,
  account: string,
  count: number,
  from = 0
): Promise<void> => {
  for (let index = from; index < count; index += 1) {
    try {
      await entryFor(ring, chunkAccount(account, index)).deleteCredential();
    } catch {
      // A missing chunk is fine — we're deleting it anyway.
    }
  }
};

/**
 * Write a secret, splitting it across `<account>#chunk<i>` entries when it
 * exceeds a single blob's budget. Throws on any underlying keyring failure
 * so the caller can report it. Chunks are written before the manifest so a
 * crash mid-write leaves the previous value referenced by the old primary
 * blob rather than a half-written one.
 */
const writeSecret = async (ring: KeyringModule, account: string, value: string): Promise<void> => {
  const previousChunks = chunkCountOf(await readPassword(ring, account));

  if (value.length <= CHUNK_SIZE) {
    await entryFor(ring, account).setPassword(value);
    // The new value fits in one blob — drop any chunks a larger prior
    // value left behind.
    await deleteChunks(ring, account, previousChunks);
    return;
  }

  const count = Math.ceil(value.length / CHUNK_SIZE);
  for (let index = 0; index < count; index += 1) {
    const part = value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    await entryFor(ring, chunkAccount(account, index)).setPassword(part);
  }
  await entryFor(ring, account).setPassword(`${CHUNK_MARKER}${count}`);
  // A prior value with more chunks leaves orphans past the new count.
  if (previousChunks > count) {
    await deleteChunks(ring, account, previousChunks, count);
  }
};

/**
 * Read a secret, reassembling chunk entries when the primary blob is a
 * manifest. A missing or unreadable chunk resolves to undefined ("no value")
 * rather than a truncated secret — callers re-authenticate on undefined,
 * which is always safe; a partial token never is.
 */
const readSecret = async (ring: KeyringModule, account: string): Promise<string | undefined> => {
  const primary = await readPassword(ring, account);
  if (primary === undefined) {
    return undefined;
  }
  const count = chunkCountOf(primary);
  if (count === 0) {
    return primary;
  }
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const part = await readPassword(ring, chunkAccount(account, index));
    if (part === undefined) {
      return undefined;
    }
    parts.push(part);
  }
  return parts.join("");
};

/** Delete a secret and any chunk entries it spans. */
const deleteSecret = async (ring: KeyringModule, account: string): Promise<boolean> => {
  const count = chunkCountOf(await readPassword(ring, account));
  if (count > 0) {
    await deleteChunks(ring, account, count);
  }
  return entryFor(ring, account).deleteCredential();
};

/** Read a credential family's value; undefined when absent or unavailable. */
const readFamily = async (prefix: string, key: string): Promise<string | undefined> => {
  const ring = await loadKeyring();
  if (!ring) {
    return undefined;
  }
  return readSecret(ring, makeAccount(prefix, key));
};

/**
 * Write a credential family's value. Returns false (never throws) on
 * failure, warning once with the underlying keyring error so the cause is
 * diagnosable instead of being silently swallowed.
 */
const writeFamily = async (
  prefix: string,
  key: string,
  value: string,
  failureMessage: string
): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    await writeSecret(ring, makeAccount(prefix, key), value);
    return true;
  } catch (error) {
    warnOnce(withReason(failureMessage, error), "error");
    return false;
  }
};

/** Delete a credential family's value (and its chunks). False on failure. */
const clearFamily = async (prefix: string, key: string): Promise<boolean> => {
  const ring = await loadKeyring();
  if (!ring) {
    return false;
  }
  try {
    return await deleteSecret(ring, makeAccount(prefix, key));
  } catch {
    // NoEntry on delete is idempotent success; other errors warn elsewhere.
    return false;
  }
};

export const getDeployToken = (envName: string): Promise<string | undefined> =>
  readFamily(DEPLOY_ACCOUNT_PREFIX, envName);

export const setDeployToken = (envName: string, token: string): Promise<boolean> =>
  writeFamily(
    DEPLOY_ACCOUNT_PREFIX,
    envName,
    token,
    "Unable to write deploy token to the OS keychain."
  );

export const clearDeployToken = (envName: string): Promise<boolean> =>
  clearFamily(DEPLOY_ACCOUNT_PREFIX, envName);

export const getPublishingToken = (envName: string): Promise<string | undefined> =>
  readFamily(PUBLISHING_ACCOUNT_PREFIX, envName);

export const setPublishingToken = (envName: string, token: string): Promise<boolean> =>
  writeFamily(
    PUBLISHING_ACCOUNT_PREFIX,
    envName,
    token,
    "Unable to write publishing token to the OS keychain."
  );

export const clearPublishingToken = (envName: string): Promise<boolean> =>
  clearFamily(PUBLISHING_ACCOUNT_PREFIX, envName);

/**
 * The cached Content Operations Brief API token, keyed by Sitecore
 * `organizationId`. The Brief API is org-scoped — one minted token
 * covers every env profile in the organization — so the cache key is
 * the org id, not an env-profile name.
 */
export const getBriefToken = (orgId: string): Promise<string | undefined> =>
  readFamily(BRIEF_ACCOUNT_PREFIX, orgId);

export const setBriefToken = (orgId: string, token: string): Promise<boolean> =>
  writeFamily(
    BRIEF_ACCOUNT_PREFIX,
    orgId,
    token,
    "Unable to write brief token to the OS keychain."
  );

export const clearBriefToken = (orgId: string): Promise<boolean> =>
  clearFamily(BRIEF_ACCOUNT_PREFIX, orgId);

export const getCampaignToken = (envName: string): Promise<string | undefined> =>
  readFamily(CAMPAIGN_ACCOUNT_PREFIX, envName);

export const setCampaignToken = (envName: string, token: string): Promise<boolean> =>
  writeFamily(
    CAMPAIGN_ACCOUNT_PREFIX,
    envName,
    token,
    "Unable to write campaign token to the OS keychain."
  );

export const clearCampaignToken = (envName: string): Promise<boolean> =>
  clearFamily(CAMPAIGN_ACCOUNT_PREFIX, envName);

/**
 * The Agentic Studio browser session for an environment, stored as a
 * JSON-serialized `AgentsCredential` (see `src/agents/session/types.ts`).
 * Unlike the other entries here this is not an OAuth token — Agentic
 * Studio has no machine-credential path yet, so scai captures a browser
 * session cookie instead. Temporary; tracked in that file.
 */
export const getAgentsCredential = (envName: string): Promise<string | undefined> =>
  readFamily(AGENTS_ACCOUNT_PREFIX, envName);

export const setAgentsCredential = (envName: string, credential: string): Promise<boolean> =>
  writeFamily(
    AGENTS_ACCOUNT_PREFIX,
    envName,
    credential,
    "Unable to write the Agentic Studio session to the OS keychain."
  );

export const clearAgentsCredential = (envName: string): Promise<boolean> =>
  clearFamily(AGENTS_ACCOUNT_PREFIX, envName);

export const getCmTokens = async (envName: string): Promise<CmTokenBundle | undefined> => {
  const raw = await readFamily(CM_ACCOUNT_PREFIX, envName);
  return raw === undefined ? undefined : safeParse<CmTokenBundle>(raw);
};

export const setCmTokens = (envName: string, tokens: CmTokenBundle): Promise<boolean> =>
  writeFamily(
    CM_ACCOUNT_PREFIX,
    envName,
    JSON.stringify(tokens),
    "Unable to write CM tokens to the OS keychain."
  );

export const clearCmTokens = (envName: string): Promise<boolean> =>
  clearFamily(CM_ACCOUNT_PREFIX, envName);

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
export const getCmClientSecret = (envName: string): Promise<string | undefined> =>
  readFamily(CM_CLIENT_ACCOUNT_PREFIX, envName);

export const setCmClientSecret = (envName: string, secret: string): Promise<boolean> =>
  writeFamily(
    CM_CLIENT_ACCOUNT_PREFIX,
    envName,
    secret,
    "Unable to write the CM client secret to the OS keychain."
  );

export const clearCmClientSecret = (envName: string): Promise<boolean> =>
  clearFamily(CM_CLIENT_ACCOUNT_PREFIX, envName);

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
export const getOrgClientSecret = (orgId: string): Promise<string | undefined> =>
  readFamily(ORG_CLIENT_ACCOUNT_PREFIX, orgId);

export const setOrgClientSecret = (orgId: string, secret: string): Promise<boolean> =>
  writeFamily(
    ORG_CLIENT_ACCOUNT_PREFIX,
    orgId,
    secret,
    "Unable to write the org automation client secret to the OS keychain."
  );

export const clearOrgClientSecret = (orgId: string): Promise<boolean> =>
  clearFamily(ORG_CLIENT_ACCOUNT_PREFIX, orgId);

/**
 * Brand credentials are keyed by Sitecore `organizationId`, not by
 * env profile. The AI APIs key is one-org-per-credential (Cloud Portal
 * → Stream → Admin → AI APIs keys), so every env profile in the same
 * org shares one credential. We store the client secret and the cached
 * access token under separate entries to keep their lifecycles
 * independent (token rotates ~daily; secret is long-lived).
 */
export const getBrandClientSecret = (orgId: string): Promise<string | undefined> =>
  readFamily(BRAND_SECRET_ACCOUNT_PREFIX, orgId);

export const setBrandClientSecret = (orgId: string, secret: string): Promise<boolean> =>
  writeFamily(
    BRAND_SECRET_ACCOUNT_PREFIX,
    orgId,
    secret,
    "Unable to write Brand client secret to the OS keychain."
  );

export const clearBrandClientSecret = (orgId: string): Promise<boolean> =>
  clearFamily(BRAND_SECRET_ACCOUNT_PREFIX, orgId);

export const getBrandToken = (orgId: string): Promise<string | undefined> =>
  readFamily(BRAND_TOKEN_ACCOUNT_PREFIX, orgId);

export const setBrandToken = (orgId: string, token: string): Promise<boolean> =>
  writeFamily(
    BRAND_TOKEN_ACCOUNT_PREFIX,
    orgId,
    token,
    "Unable to write Brand token to the OS keychain."
  );

export const clearBrandToken = (orgId: string): Promise<boolean> =>
  clearFamily(BRAND_TOKEN_ACCOUNT_PREFIX, orgId);
