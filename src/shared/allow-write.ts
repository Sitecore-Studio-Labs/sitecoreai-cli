import path from "node:path";
import type { RootConfiguration } from "@/config/types";
import { createScaiError } from "./errors";
import { authorizeOperation, riskTierForOperation } from "@/policy";
import type { OperationId } from "@/policy";

/**
 * Per-environment write gate. Throws `INPUT_INVALID` unless the
 * environment is configured to allow writes (via `allowWrite` in
 * `sitecoreai.cli.json`, an `SITECOREAI_ENV_<NAME>_ALLOW_WRITE=true`
 * env var, or the per-invocation `override` boolean — typically the
 * caller's `--allow-write` flag).
 *
 * Used by hygiene cleanups, workflow mutations, and any other
 * caller-of-record for tenant-side writes. Same gate, one source of
 * truth — see `feedback_destructive_ops_need_consent` for the broader
 * consent model these commands sit inside.
 *
 * MCP note: when an MCP write tool is invoked, the registry dispatch
 * has already cleared the host's write-confirmation UX, so the MCP
 * layer auto-elevates `allowWrite: true` before calling runners. That
 * means *this* gate is effectively a no-op for MCP callers — the
 * library can't tell elevation apart from a direct `--allow-write`.
 * `ensureMcpElevationAllowed` is the companion gate enforced at the
 * MCP tool boundary; together they let an env opt out of MCP-driven
 * writes via `denyMcpElevation` without changing CLI behaviour.
 */
export const ensureAllowWrite = (
  root: RootConfiguration,
  envName: string,
  override?: boolean,
  operation?: OperationId
): void => {
  const env = root.environments[envName];
  // Workspace-policy gate — environment ceiling + caller context, at the
  // risk tier the operation registry assigns (`write` by default,
  // `destructive` for a registered destructive operation). Runs
  // unconditionally: `--allow-write` (override) bypasses the config
  // `allowWrite` requirement below but never the policy. A no-op in
  // unmanaged mode. See docs/policy-and-guardrails.md.
  authorizeOperation({
    envName,
    configRootDir: root.physicalPath ? path.dirname(root.physicalPath) : undefined,
    tier: operation ? riskTierForOperation(operation) : "write",
    tokenLastUpdated: env?.deployTokenLastUpdated ?? undefined,
  });
  if (override || env?.allowWrite) return;
  const envKey = envName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  throw createScaiError(
    `Environment ${envName} is not configured to allow writing data.`,
    "INPUT_INVALID",
    {
      hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
    }
  );
};

/**
 * MCP boundary gate. Throws `AUTH_DENIED` when the target environment
 * has opted out of MCP-elevated writes via `denyMcpElevation: true`.
 * Call this from every MCP write tool's handler (auth: "write") before
 * delegating to a destructive runner — `ensureAllowWrite` alone can't
 * see the elevation origin once it's been folded into `options.allowWrite`.
 *
 * The intent is per-environment risk control: a sandbox env keeps the
 * default (MCP elevation allowed); a production-shaped env can set
 * `denyMcpElevation: true` to require every destructive op originate
 * from a human CLI invocation. The flag doesn't affect direct CLI use.
 */
export const ensureMcpElevationAllowed = (root: RootConfiguration, envName: string): void => {
  const env = root.environments?.[envName];
  if (env?.denyMcpElevation !== true) return;
  throw createScaiError(
    `Environment ${envName} has denyMcpElevation set; MCP write tools cannot mutate this tenant.`,
    "AUTH_DENIED",
    {
      hint: "Run the destructive command via the CLI with --allow-write, or set denyMcpElevation: false in sitecoreai.cli.json if MCP-driven writes are acceptable here.",
    }
  );
};
