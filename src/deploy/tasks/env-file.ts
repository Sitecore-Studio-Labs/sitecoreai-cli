import fs from "node:fs";
import path from "node:path";
import { resolveEnvironment } from "@/policy/environment";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";
import { fetchEnvironmentEdgeToken, fetchEnvironmentEditingSecret } from "../api/environments";
import { getDeployContext, toLogger } from "./shared";

/**
 * `scai provision deploy env-file` — write/update a Content SDK head app's
 * `.env.local` by looking up the live connection values from the Deploy API:
 * the **Edge context id** (`obtain-edge-token` → `apiKey`) and the **editing
 * secret** (`obtain-editing-secret`). Fills the site name / language from the
 * env profile. Merges into an existing file — only the managed keys are
 * upserted; anything else you've set is preserved.
 *
 * Replaces the bespoke `.env.local` generation each head-app pipeline otherwise
 * hand-rolls. Pair with `deploy build-config` (the xmcloud.build.json writer).
 */

export type DeployEnvFileOptions = CommonOptions & {
  environmentName?: string;
  /** SXA site name for NEXT_PUBLIC_DEFAULT_SITE_NAME. Falls back to the profile's `site`. */
  site?: string;
  /** Default language. Defaults to `en`. */
  language?: string;
  /** Path to write. Defaults to ./.env.local. */
  output?: string;
  whatIf?: boolean;
};

/** Keys this command owns; everything else in the file is preserved verbatim. */
export const MANAGED_ENV_KEYS = [
  "SITECORE_EDGE_CONTEXT_ID",
  "NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID",
  "SITECORE_EDITING_SECRET",
  "NEXT_PUBLIC_DEFAULT_SITE_NAME",
  "NEXT_PUBLIC_DEFAULT_LANGUAGE",
] as const;

/**
 * Upsert `KEY=VALUE` pairs into existing dotenv content: matching keys are
 * replaced in place, new keys appended, all other lines (comments, blanks,
 * unmanaged vars) preserved. Pure — exposed for unit tests.
 */
export const upsertEnvVars = (existing: string, vars: Record<string, string>): string => {
  const keys = new Set(Object.keys(vars));
  const written = new Set<string>();
  const out = existing.split(/\r?\n/).map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (match && keys.has(match[1])) {
      written.add(match[1]);
      return `${match[1]}=${vars[match[1]]}`;
    }
    return line;
  });
  let result = out.join("\n").replace(/\n+$/, "");
  const appended = Object.keys(vars)
    .filter((key) => !written.has(key))
    .map((key) => `${key}=${vars[key]}`);
  if (appended.length > 0) {
    result = (result ? `${result}\n` : "") + appended.join("\n");
  }
  return `${result}\n`;
};

export const runDeployEnvFile = async (options: DeployEnvFileOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const environmentId = context.environmentId;
  if (!environmentId) {
    throw createScaiError(
      `Environment '${context.envName}' has no environmentId on its profile.`,
      "INPUT_INVALID",
      { hint: "Run 'scai setup init' to populate the Deploy environment IDs." }
    );
  }

  const apiOptions = { accessToken: context.token, baseUrl: context.baseUrl };
  const edge = (await fetchEnvironmentEdgeToken(apiOptions, environmentId)) as {
    apiKey?: string;
  } | null;
  const secretResult = await fetchEnvironmentEditingSecret(apiOptions, environmentId);
  const editingSecret =
    typeof secretResult === "string" ? secretResult : (secretResult as { secret?: string })?.secret;

  const { environment } = resolveEnvironment(options);
  const site = options.site?.trim() || environment.site?.trim();
  const language = options.language?.trim() || "en";

  const vars: Record<string, string> = {};
  if (edge?.apiKey) {
    vars.SITECORE_EDGE_CONTEXT_ID = edge.apiKey;
    vars.NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID = edge.apiKey;
  }
  if (editingSecret) vars.SITECORE_EDITING_SECRET = editingSecret;
  if (site) vars.NEXT_PUBLIC_DEFAULT_SITE_NAME = site;
  vars.NEXT_PUBLIC_DEFAULT_LANGUAGE = language;

  const outputPath = path.resolve(options.output ?? path.join(process.cwd(), ".env.local"));
  const writtenKeys = Object.keys(vars);

  if (options.whatIf) {
    // Never print secret values — only which keys would be written.
    if (logger.isJson()) {
      logger.json({
        command: "deploy.env-file",
        output: outputPath,
        whatIf: true,
        keys: writtenKeys,
      });
    } else {
      logger.info(
        `[dry-run] would write ${writtenKeys.length} variable(s) to ${outputPath}:`,
        "yellow"
      );
      for (const key of writtenKeys)
        logger.info(
          `  ${key}=${key.includes("SECRET") || key.includes("CONTEXT_ID") ? "***" : vars[key]}`
        );
    }
    return;
  }

  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  fs.writeFileSync(outputPath, upsertEnvVars(existing, vars));

  if (logger.isJson()) {
    logger.json({
      command: "deploy.env-file",
      output: outputPath,
      environment: context.envName,
      keys: writtenKeys,
    });
  } else {
    logger.info(
      `Wrote ${writtenKeys.length} variable(s) to ${outputPath} — Edge context id + editing secret resolved from '${context.envName}'.`,
      "green"
    );
  }
};
