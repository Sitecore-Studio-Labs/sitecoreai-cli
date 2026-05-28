/**
 * `scai doctor` — local-config + credentials diagnostics.
 *
 * Different from `scai cli health`, which probes the live deploy /
 * sites tenant: doctor stays local. It walks the operator's
 * sitecoreai.cli.json + keychain + Node setup and tells them what
 * needs fixing before any remote call should be expected to work.
 *
 * Categories of checks (in order):
 *
 *  1. Runtime — Node version meets the package.json engines floor.
 *  2. Config — sitecoreai.cli.json exists, parses, validates against
 *     the JSON Schema, has a default env (or exactly one env).
 *  3. Per-env — required fields present, deploy token in keychain,
 *     token freshness within TTL.
 *  4. Brand — for each `brand[orgId]` config block, the secret is in
 *     keychain so brand operations have something to mint with.
 *
 * Each check produces a row in the result table. Failures are
 * actionable: every `fail` carries a `hint` naming the exact command
 * or env var that fixes it.
 *
 * Output: human-readable table (default) or `{ checks, summary }`
 * envelope when `--json`. Process exit is non-zero on any `fail`;
 * `--strict` also fails on `warn`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError, type ScaiError } from "@/shared/errors";
import { readRootConfigurationFile } from "@/config/root-config";
import { validateRootConfig, formatValidationErrors } from "@/config/validation";
import { getDeployToken, getBrandClientSecret } from "@/shared/keychain";

export type DoctorStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  /** Category label, e.g. "runtime", "config", "env:sandbox", "brand:org_ABC". */
  category: string;
  /** Short check name, e.g. "node-version", "config-file", "deploy-token". */
  name: string;
  status: DoctorStatus;
  /** One-line summary suitable for the human table. */
  message: string;
  /** Optional next step the operator should take. */
  hint?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  summary: Record<DoctorStatus, number>;
}

export interface RunDoctorOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  trace?: boolean;
  logFile?: string;
  /** When true, exit non-zero on any `warn` (not just `fail`). */
  strict?: boolean;
}

const NODE_ENGINES_FLOOR = 20;

const buildLogger = (options: RunDoctorOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const summarize = (checks: DoctorCheck[]): DoctorResult["summary"] => {
  const summary: DoctorResult["summary"] = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status] += 1;
  return summary;
};

const checkRuntime = (): DoctorCheck => {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major >= NODE_ENGINES_FLOOR) {
    return {
      category: "runtime",
      name: "node-version",
      status: "ok",
      message: `Node ${process.versions.node} (>= ${NODE_ENGINES_FLOOR}).`,
    };
  }
  return {
    category: "runtime",
    name: "node-version",
    status: "fail",
    message: `Node ${process.versions.node} is below the ${NODE_ENGINES_FLOOR} floor.`,
    hint: `Upgrade Node to ${NODE_ENGINES_FLOOR}.x or later. nvm: \`nvm install ${NODE_ENGINES_FLOOR}\`.`,
  };
};

const checkConfigFile = (
  configPath: string
): { check: DoctorCheck; configFile?: ReturnType<typeof readRootConfigurationFile> } => {
  const filePath = path.join(configPath, "sitecoreai.cli.json");
  if (!existsSync(filePath)) {
    return {
      check: {
        category: "config",
        name: "config-file",
        status: "fail",
        message: `sitecoreai.cli.json not found at ${configPath}.`,
        hint: "Run `scai setup init` to scaffold one in this directory.",
      },
    };
  }
  try {
    const configFile = readRootConfigurationFile(configPath);
    return {
      check: {
        category: "config",
        name: "config-file",
        status: "ok",
        message: `sitecoreai.cli.json found at ${filePath}.`,
      },
      configFile,
    };
  } catch (error) {
    return {
      check: {
        category: "config",
        name: "config-file",
        status: "fail",
        message: `sitecoreai.cli.json is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        hint: "Fix the JSON syntax, or rerun `scai setup init --force` to start over (existing config will be backed up).",
      },
    };
  }
};

const checkConfigSchema = (configPath: string): DoctorCheck => {
  const filePath = path.join(configPath, "sitecoreai.cli.json");
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const ok = validateRootConfig(parsed);
    if (ok) {
      return {
        category: "config",
        name: "config-schema",
        status: "ok",
        message: "Config matches the root JSON Schema.",
      };
    }
    const errors = formatValidationErrors(validateRootConfig.errors ?? []);
    return {
      category: "config",
      name: "config-schema",
      status: "warn",
      message: `Schema validation reported ${errors.length} issue(s).`,
      hint: `First: ${errors[0] ?? "(no detail)"}. Run \`scai cli config --validate\` for the full list.`,
    };
  } catch (error) {
    return {
      category: "config",
      name: "config-schema",
      status: "skip",
      message: `Skipped — could not parse config: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

const checkDefaultEnv = (configFile: ReturnType<typeof readRootConfigurationFile>): DoctorCheck => {
  const envProfiles = configFile.config.envProfiles ?? {};
  const names = Object.keys(envProfiles).filter((n) => n !== "default");
  const defaultName = configFile.config.defaultEnvProfile;
  if (names.length === 0) {
    return {
      category: "config",
      name: "default-env",
      status: "fail",
      message: "No env profiles configured.",
      hint: "Run `scai setup env add` to add an environment profile.",
    };
  }
  if (defaultName && envProfiles[defaultName]) {
    return {
      category: "config",
      name: "default-env",
      status: "ok",
      message: `defaultEnvProfile resolves to '${defaultName}'.`,
    };
  }
  if (names.length === 1) {
    return {
      category: "config",
      name: "default-env",
      status: "warn",
      message: `One env profile ('${names[0]}'); defaultEnvProfile not set.`,
      hint: `Set defaultEnvProfile to '${names[0]}' in sitecoreai.cli.json to avoid passing --environment-name on every call.`,
    };
  }
  return {
    category: "config",
    name: "default-env",
    status: "warn",
    message: `${names.length} env profiles, no default set.`,
    hint: "Set defaultEnvProfile in sitecoreai.cli.json so commands default to your active environment.",
  };
};

const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

const checkEnvProfile = async (
  name: string,
  env: Record<string, unknown>
): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];

  const missing = ["organizationId", "type"].filter((field) => !env[field]);
  checks.push(
    missing.length === 0
      ? {
          category: `env:${name}`,
          name: "required-fields",
          status: "ok",
          message: "organizationId + type are set.",
        }
      : {
          category: `env:${name}`,
          name: "required-fields",
          status: "fail",
          message: `Missing required fields: ${missing.join(", ")}.`,
          hint: `Edit sitecoreai.cli.json or rerun \`scai setup env edit --environment-name ${name}\`.`,
        }
  );

  try {
    const token = await getDeployToken(name);
    if (!token) {
      checks.push({
        category: `env:${name}`,
        name: "deploy-token",
        status: "fail",
        message: "No deploy token in keychain.",
        hint: `Run \`scai setup login --environment-name ${name}\` to authenticate.`,
      });
    } else {
      checks.push({
        category: `env:${name}`,
        name: "deploy-token",
        status: "ok",
        message: "Deploy token present in keychain.",
      });

      const expiresIn = env.deployTokenExpiresIn as number | undefined;
      const lastUpdated = env.deployTokenLastUpdated as string | undefined;
      if (expiresIn && lastUpdated) {
        const issuedAt = Date.parse(lastUpdated);
        const expiresAt = issuedAt + expiresIn * 1000;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          checks.push({
            category: `env:${name}`,
            name: "deploy-token-ttl",
            status: "warn",
            message: `Deploy token expired ${Math.round(-remaining / 1000)}s ago.`,
            hint: `Run \`scai setup login --environment-name ${name}\` to refresh.`,
          });
        } else if (remaining < TOKEN_REFRESH_THRESHOLD_MS) {
          checks.push({
            category: `env:${name}`,
            name: "deploy-token-ttl",
            status: "warn",
            message: `Deploy token expires in ${Math.round(remaining / 1000)}s.`,
            hint: `Run \`scai setup login --environment-name ${name}\` to refresh proactively.`,
          });
        } else {
          checks.push({
            category: `env:${name}`,
            name: "deploy-token-ttl",
            status: "ok",
            message: `Deploy token valid for ~${Math.round(remaining / 60000)} min.`,
          });
        }
      }
    }
  } catch (error) {
    checks.push({
      category: `env:${name}`,
      name: "deploy-token",
      status: "warn",
      message: `Keychain probe failed: ${error instanceof Error ? error.message : String(error)}`,
      hint: "OS keychain may be locked or unavailable; on serverless, use SITECOREAI_*_DEPLOY_TOKEN env vars.",
    });
  }

  return checks;
};

const checkBrandKeychain = async (
  configFile: ReturnType<typeof readRootConfigurationFile>
): Promise<DoctorCheck[]> => {
  const brand = configFile.config.brand;
  if (!brand) return [];
  const checks: DoctorCheck[] = [];
  for (const [orgId, entry] of Object.entries(brand)) {
    const credential = entry as { clientId?: string };
    if (!credential?.clientId) {
      checks.push({
        category: `brand:${orgId}`,
        name: "client-id",
        status: "fail",
        message: "No clientId on the brand credential.",
        hint: `Run \`scai setup login brand --org-id ${orgId}\` to provision one.`,
      });
      continue;
    }
    try {
      const secret = await getBrandClientSecret(orgId);
      if (!secret) {
        checks.push({
          category: `brand:${orgId}`,
          name: "client-secret",
          status: "fail",
          message: `clientId '${credential.clientId}' is set but no secret in keychain.`,
          hint: `Run \`scai setup login brand --org-id ${orgId}\` to (re)store the secret.`,
        });
      } else {
        checks.push({
          category: `brand:${orgId}`,
          name: "client-secret",
          status: "ok",
          message: "Brand credential complete (clientId + keychain secret).",
        });
      }
    } catch (error) {
      checks.push({
        category: `brand:${orgId}`,
        name: "client-secret",
        status: "warn",
        message: `Keychain probe failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return checks;
};

export const runDoctor = async (options: RunDoctorOptions = {}): Promise<DoctorResult> => {
  const logger = buildLogger(options);
  const configPath = options.config ?? process.cwd();
  const checks: DoctorCheck[] = [];

  checks.push(checkRuntime());

  const { check: configFileCheck, configFile } = checkConfigFile(configPath);
  checks.push(configFileCheck);

  if (configFileCheck.status !== "ok" || !configFile) {
    // Without a valid config file every downstream check is moot —
    // surface skipped rows so the human output keeps the same shape
    // and JSON consumers can branch on the summary.
    checks.push({
      category: "config",
      name: "config-schema",
      status: "skip",
      message: "Skipped — config file is missing or unreadable.",
    });
    checks.push({
      category: "config",
      name: "default-env",
      status: "skip",
      message: "Skipped — no config to inspect.",
    });
  } else {
    checks.push(checkConfigSchema(configPath));
    checks.push(checkDefaultEnv(configFile));

    const envProfiles = configFile.config.envProfiles ?? {};
    const names = Object.keys(envProfiles)
      .filter((n) => n !== "default")
      .sort();
    for (const name of names) {
      const envChecks = await checkEnvProfile(name, envProfiles[name] as Record<string, unknown>);
      checks.push(...envChecks);
    }

    checks.push(...(await checkBrandKeychain(configFile)));
  }

  const summary = summarize(checks);
  const result: DoctorResult = { checks, summary };

  if (logger.isJson()) {
    const envelope = buildScaiEnvelope({
      command: "doctor",
      environment: null,
      data: result,
      extra: {
        summary: `${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail, ${summary.skip} skipped.`,
      },
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    logger.info("\nscai doctor — diagnostics\n", "cyan");
    for (const c of checks) {
      const icon =
        c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : c.status === "fail" ? "✗" : "○";
      const color =
        c.status === "ok"
          ? "green"
          : c.status === "warn"
            ? "yellow"
            : c.status === "fail"
              ? "red"
              : "gray";
      logger.info(`  ${icon}  [${c.category}] ${c.name}: ${c.message}`, color);
      if (c.hint && c.status !== "ok") logger.info(`        → ${c.hint}`, "gray");
    }
    logger.info(
      `\nSummary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail, ${summary.skip} skipped.\n`,
      summary.fail > 0 ? "red" : summary.warn > 0 ? "yellow" : "green"
    );
  }

  if (summary.fail > 0 || (options.strict && summary.warn > 0)) {
    const failed: ScaiError = createScaiError(
      summary.fail > 0
        ? `scai doctor found ${summary.fail} failure(s).`
        : `scai doctor found ${summary.warn} warning(s) (strict mode).`,
      "INPUT_INVALID",
      {
        hint: "Review the rows above and re-run after applying the suggested fixes.",
      }
    );
    throw failed;
  }

  return result;
};
