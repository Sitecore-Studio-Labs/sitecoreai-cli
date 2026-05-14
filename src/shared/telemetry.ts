import { consola } from "consola";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import AjvDraft4 from "ajv-draft-04";
import { readRootConfigurationFile, writeRootConfigurationFile } from "../config/root-config";
import telemetrySchema from "../config/telemetry.schema.json";
import { redactArgs } from "./redact";

type TelemetryEventType = "command_start" | "command_success" | "command_error";

type TelemetryEvent = {
  event: TelemetryEventType;
  command: string;
  args: string[];
  durationMs?: number;
  error?: string;
  configPath?: string;
};

let cliVersion: string | null = null;
const TELEMETRY_SCHEMA_VERSION = "1";
const TELEMETRY_TIMEOUT_MS = Number(process.env.SITECOREAI_TELEMETRY_TIMEOUT_MS ?? 5000);
const telemetryAjv = new AjvDraft4({ allErrors: true, strict: false });
const validateTelemetryPayload = telemetryAjv.compile(telemetrySchema);

const toBoolean = (value?: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
};

const isCI = (): boolean =>
  Boolean(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL ||
    process.env.TEAMCITY_VERSION
  );

const tryReadRootConfigurationFile = (
  configPath: string
): { rootPath: string; config: { settings?: { telemetryEnabled?: boolean } } } | null => {
  try {
    return readRootConfigurationFile(configPath);
  } catch {
    return null;
  }
};

export const ensureTelemetryConsent = async (configPath?: string): Promise<void> => {
  const override = toBoolean(process.env.SITECOREAI_TELEMETRY);
  if (override !== undefined) {
    return;
  }

  if (process.env.DISABLE_TELEMETRY || process.env.DO_NOT_TRACK) {
    return;
  }

  if (!configPath) {
    return;
  }

  const root = tryReadRootConfigurationFile(configPath);
  if (!root) {
    return;
  }

  const existing = root.config.settings?.telemetryEnabled;
  if (typeof existing === "boolean") {
    return;
  }

  if (isCI() || !process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      "Allow anonymous telemetry to improve the SitecoreAI CLI? (y/N) "
    );
    const accepted = ["y", "yes"].includes(answer.trim().toLowerCase());
    const nextConfig = {
      ...root.config,
      settings: {
        ...(root.config.settings ?? {}),
        telemetryEnabled: accepted,
      },
    };
    writeRootConfigurationFile(root.rootPath, nextConfig);
    if (accepted) {
      consola.info("Telemetry enabled. Thank you!");
    } else {
      consola.info("Telemetry disabled. You can re-enable it later.");
    }
  } catch (error) {
    consola.debug(
      `Telemetry consent prompt failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    rl.close();
  }
};

const resolveTelemetryStatus = (configPath?: string): { enabled: boolean; source: string } => {
  const override = toBoolean(process.env.SITECOREAI_TELEMETRY);
  if (override !== undefined) {
    return { enabled: override, source: "env SITECOREAI_TELEMETRY" };
  }

  if (process.env.DISABLE_TELEMETRY || process.env.DO_NOT_TRACK) {
    return { enabled: false, source: "env DISABLE_TELEMETRY/DO_NOT_TRACK" };
  }

  if (!configPath) {
    return { enabled: false, source: "config not found" };
  }

  const root = tryReadRootConfigurationFile(configPath);
  if (!root) {
    return { enabled: false, source: "config not found" };
  }

  return {
    enabled: root.config.settings?.telemetryEnabled ?? false,
    source: "config settings.telemetryEnabled",
  };
};

// Hostname under a domain the project controls (cf. the $id schema URL at
// https://schemas.sitecoreai.dev/v1/telemetry.schema.json — DNS is in the
// same zone). Replaces the previous telemetry-api-ten.vercel.app default,
// which was a Vercel preview-style subdomain and therefore squattable.
// Override per-invocation with SITECOREAI_TELEMETRY_URL.
const DEFAULT_TELEMETRY_URL = "https://cli-telemetry.sitecoreai.dev/v1/t";
const getTelemetryUrl = (): string => process.env.SITECOREAI_TELEMETRY_URL ?? DEFAULT_TELEMETRY_URL;

export const setTelemetryVersion = (version: string): void => {
  cliVersion = version;
};

export const resolveConfigPathFromArgs = (argv: string[]): string | undefined => {
  const configFlagIndex = argv.findIndex((arg) => arg === "--config" || arg === "-c");
  if (configFlagIndex >= 0 && argv[configFlagIndex + 1]) {
    return argv[configFlagIndex + 1];
  }

  const configInline = argv.find((arg) => arg.startsWith("--config="));
  if (configInline) {
    return configInline.slice("--config=".length);
  }

  return undefined;
};

export const formatTelemetryCommand = (args: string[]): string => {
  const sanitized = redactArgs(args);
  const commandTokens: string[] = [];
  for (const entry of sanitized) {
    if (entry.startsWith("-")) {
      break;
    }
    commandTokens.push(entry);
  }
  return commandTokens.join(" ").trim() || "(no command)";
};

export const recordTelemetry = async (event: TelemetryEvent): Promise<void> => {
  const url = getTelemetryUrl();
  if (!url) {
    return;
  }

  if (!resolveTelemetryStatus(event.configPath).enabled) {
    return;
  }

  try {
    const payload = {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      nonce: randomUUID(),
      event: event.event,
      command: event.command,
      durationMs: event.durationMs,
      error: event.error ? true : undefined,
      v: cliVersion ?? "unknown",
      ci: isCI(),
    };

    if (!validateTelemetryPayload(payload)) {
      const errors = validateTelemetryPayload.errors ?? [];
      consola.debug(`Telemetry payload failed schema validation (${errors.length} errors).`);
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-SitecoreAI-Client": "sitecoreai-cli",
      "User-Agent": `sitecoreai-cli/${cliVersion ?? "unknown"}`,
    };

    const traceEnabled = process.env.SITECOREAI_TRACE_HTTP === "1";
    const maxRetries = Math.max(0, Number(process.env.SITECOREAI_TELEMETRY_RETRIES ?? 1));
    const retryBaseMs = Math.max(0, Number(process.env.SITECOREAI_TELEMETRY_RETRY_BASE_MS ?? 250));

    void (async () => {
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (response.ok) {
            return;
          }
          if (attempt >= maxRetries && traceEnabled) {
            consola.debug(`Telemetry request failed (${response.status}).`);
            return;
          }
        } catch (error) {
          if (attempt >= maxRetries && traceEnabled) {
            consola.debug(
              `Telemetry request failed: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
          }
        } finally {
          clearTimeout(timeout);
        }

        if (attempt < maxRetries && retryBaseMs > 0) {
          const delay = retryBaseMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    })();
  } catch (error) {
    consola.debug(`Telemetry failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const getTelemetryStatus = (
  configPath?: string
): { enabled: boolean; source: string; url: string } => {
  const status = resolveTelemetryStatus(configPath);
  return { ...status, url: getTelemetryUrl() };
};
