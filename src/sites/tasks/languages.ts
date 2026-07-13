/**
 * Task runners for `scai provision sites language` — environment-level
 * language management over the Sites API.
 *
 * Languages are environment-scoped: a language added here is available to
 * every site in the environment AND surfaces to higher-level consumers that
 * read the environment's languages (notably the Sitecore AI brand-kit
 * Glossary's org locales). The Sites API access token is minted from the
 * env profile's automation client via `getAccessToken` — the same path the
 * recipe push pipeline uses.
 */
import { getAccessToken } from "@/auth";
import { ensureAllowWrite } from "@/policy/allow-write";
import { resolveEnvironment } from "@/policy/environment";
import {
  addLanguage,
  fallbackLanguageIsoFor,
  listLanguages,
  listSupportedLanguages,
  parseLanguageCode,
  removeLanguage,
  updateLanguage,
  type SitesApiClientOptions,
} from "@/sites";
import { toLogger } from "@/shared/cli-tasks";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import type { Logger } from "@/shared/logger";

export interface SitesLanguageOptions {
  config?: string;
  environmentName?: string;
  json?: boolean;
  quiet?: boolean;
  format?: string;
  /** Regional ISO code (e.g. `fr-FR`, `da-DK`). */
  code?: string;
  allowWrite?: boolean;
  apply?: boolean;
  whatIf?: boolean;
}

const resolveSites = async (options: SitesLanguageOptions) => {
  const { envName, environment, root } = resolveEnvironment(options);
  const accessToken = await getAccessToken(environment);
  if (!accessToken) {
    throw createScaiError(
      `Failed to mint a Sites API access token for environment '${envName}'. Run 'scai setup login', then retry.`,
      "AUTH_REQUIRED"
    );
  }
  const client: SitesApiClientOptions = { accessToken };
  return { envName, root, client };
};

const emit = (logger: Logger, envName: string, command: string, data: unknown): void => {
  if (logger.isJson()) {
    logger.json(buildScaiEnvelope({ command, environment: envName, data }));
    return;
  }
  logger.info(JSON.stringify(data, null, 2));
};

const requireCode = (options: SitesLanguageOptions): string => {
  if (!options.code) {
    throw createScaiError(
      "A language code is required. Use --code (e.g. --code fr-FR).",
      "INPUT_INVALID"
    );
  }
  return options.code;
};

/** List the languages currently added to the environment. */
export const runSitesLanguageList = async (options: SitesLanguageOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, client } = await resolveSites(options);
  emit(logger, envName, "sites.language.list", await listLanguages(client));
};

/** List the languages SitecoreAI supports (the catalog you can add from). */
export const runSitesLanguageListSupported = async (
  options: SitesLanguageOptions
): Promise<void> => {
  const logger = toLogger(options);
  const { envName, client } = await resolveSites(options);
  emit(logger, envName, "sites.language.list-supported", await listSupportedLanguages(client));
};

/**
 * Add a language to the environment (idempotent server-side), then wire
 * its fallback language so Sitecore's language-fallback chain matches
 * the base-locale model (regional → base when present → `en`; base →
 * `en`). Fallback wiring is best-effort — a failed PATCH never fails
 * the add.
 */
export const runSitesLanguageAdd = async (options: SitesLanguageOptions): Promise<void> => {
  const logger = toLogger(options);
  const code = requireCode(options);
  const { envName, root, client } = await resolveSites(options);
  ensureAllowWrite(root, envName, options.allowWrite);
  const added = await addLanguage(client, parseLanguageCode(code));
  const wireFallback = async (): Promise<string | null> => {
    try {
      const present = new Set<string>();
      for (const lang of await listLanguages(client)) {
        if (lang.iso) present.add(lang.iso.toLowerCase());
        if (lang.regionalIsoCode) present.add(lang.regionalIsoCode.toLowerCase());
      }
      present.add(code.toLowerCase());
      const fallback = fallbackLanguageIsoFor(code, present);
      if (fallback) {
        await updateLanguage(client, code, {
          ...parseLanguageCode(code),
          fallbackLanguageIso: fallback,
        });
      }
      return fallback;
    } catch {
      return null; // best-effort — the add itself succeeded
    }
  };
  const fallbackLanguageIso = await wireFallback();
  emit(logger, envName, "sites.language.add", { ...added, fallbackLanguageIso });
};

/** Remove a language from the environment (destructive — gated by --apply). */
export const runSitesLanguageRemove = async (options: SitesLanguageOptions): Promise<void> => {
  const logger = toLogger(options);
  const code = requireCode(options);
  const { envName, root, client } = await resolveSites(options);
  ensureAllowWrite(root, envName, options.allowWrite);
  const removed = await removeLanguage(client, code);
  emit(logger, envName, "sites.language.remove", { code, removed });
};
