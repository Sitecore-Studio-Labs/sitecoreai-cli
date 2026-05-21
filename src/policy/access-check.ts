/**
 * `checkAccess` — the access preflight.
 *
 * Answers "can I operate against environment X, and if not, what is the
 * one thing blocking me?" in a single offline call. It aggregates the
 * three gates an operation must clear — config, workspace policy, and
 * credentials — so an agent learns every blocker at once instead of
 * discovering them one failed call at a time.
 *
 * Offline by design: config read + policy resolution + credential
 * presence, no network. A fast preflight, not a health probe. The MCP
 * `access_check` tool is the thin wrapper over this.
 */

import path from "node:path";
import type { EnvironmentConfiguration } from "@/config/types";
import { readRootConfiguration } from "@/config/root-config";
import { toScaiError, type Remediation } from "@/shared/errors";
import { resolveCredentialMatrix } from "@/shared/credential-matrix";
import { HUMAN_ONLY_OPERATIONS, type HumanOnlyOperation } from "@/shared/human-only-operations";
import { describeIdentityDrift, extractIdentity } from "./identity";
import { resolveEffectivePolicy } from "./resolve";

/** Per-gate verdict. `warn` is non-blocking — informational only. */
export type GateStatus = "ok" | "blocked" | "warn";

/** One gate in the access preflight. */
export interface AccessGate {
  id: "config" | "policy" | "credentials";
  status: GateStatus;
  /** One-line human summary of the gate's verdict. */
  summary: string;
  /** Structured remediation — present iff `status` is `blocked`. */
  remediation?: Remediation;
}

/** The full preflight result. */
export interface AccessReport {
  environment: string;
  /** True when no gate is `blocked` — the environment is ready to use. */
  ready: boolean;
  gates: AccessGate[];
  /**
   * The first blocking gate's remediation, hoisted so a caller can act
   * on the single next step without scanning `gates`.
   */
  nextStep?: Remediation;
  /**
   * Operations no agent can perform regardless of gate state — a human
   * must run them. Surfaced so the caller never mistakes one for an
   * agent-clearable blocker.
   */
  humanOnlyOperations: readonly HumanOnlyOperation[];
}

export interface CheckAccessOptions {
  /** Directory holding `sitecoreai.cli.json`, or a path to it. */
  configPath: string;
  /** Environment profile name to preflight. */
  environmentName: string;
}

/**
 * Run the three-gate preflight for one environment. Never throws — every
 * failure mode (missing config, denied policy, absent credential) is
 * reported as a `blocked` gate with a structured remediation.
 */
export const checkAccess = async (options: CheckAccessOptions): Promise<AccessReport> => {
  const { configPath, environmentName: envName } = options;
  const gates: AccessGate[] = [];

  // --- Gate 1: config -----------------------------------------------------
  let environment: EnvironmentConfiguration | undefined;
  let configRootDir: string | undefined;
  let brandPresent = false;
  let orgClientMetadata = false;
  try {
    const root = readRootConfiguration(configPath, envName);
    configRootDir = root.physicalPath ? path.dirname(root.physicalPath) : undefined;
    environment = root.environments[envName];
    if (environment) {
      const orgId = environment.organizationId;
      brandPresent = Boolean(orgId && root.brand?.[orgId]);
      orgClientMetadata = Boolean(orgId && root.orgClients?.[orgId]?.clientId);
      gates.push({
        id: "config",
        status: "ok",
        summary: `Environment '${envName}' is configured in sitecoreai.cli.json.`,
      });
    } else {
      gates.push({
        id: "config",
        status: "blocked",
        summary: `Environment '${envName}' is not in sitecoreai.cli.json.`,
        remediation: {
          actor: "agent",
          fix: `scai setup init -n ${envName}`,
          detail: "Adds the environment profile to the config.",
        },
      });
    }
  } catch (error) {
    gates.push({
      id: "config",
      status: "blocked",
      summary: `Configuration could not be read: ${toScaiError(error).message}`,
      remediation: {
        actor: "agent",
        fix: "scai setup init",
        detail: "Creates a sitecoreai.cli.json in the working tree.",
      },
    });
  }

  // --- Gate 2: workspace policy ------------------------------------------
  const policy = resolveEffectivePolicy(envName, configRootDir);
  if (!policy.managed) {
    gates.push({
      id: "policy",
      status: "ok",
      summary:
        "Unmanaged mode — no workspace-policy allowlist; every configured environment is permitted.",
    });
  } else if (!policy.enrolled) {
    gates.push({
      id: "policy",
      status: "blocked",
      summary: `Environment '${envName}' is not on the workspace-policy allowlist.`,
      remediation: {
        actor: "agent",
        fix: `scai policy allow ${envName}`,
        detail: "Enrolls the environment in the workspace-policy allowlist.",
      },
    });
  } else if (
    environment &&
    policy.identity &&
    describeIdentityDrift(policy.identity, extractIdentity(environment)).length > 0
  ) {
    gates.push({
      id: "policy",
      status: "blocked",
      summary: `Environment '${envName}' tenant identity has drifted from what was pinned at enrollment.`,
      remediation: {
        actor: "agent",
        fix: `scai policy trust ${envName}`,
        detail:
          "Re-pins the tenant identity to the current config — only if the change is expected.",
      },
    });
  } else {
    gates.push({
      id: "policy",
      status: "ok",
      summary: `Enrolled — ceiling '${policy.ceiling}', minting ${policy.mintCredentials ? "permitted" : "not permitted"}.`,
    });
  }

  // --- Gate 3: credentials -----------------------------------------------
  if (!environment) {
    gates.push({
      id: "credentials",
      status: "warn",
      summary: "Cannot evaluate credentials — the environment is not configured.",
    });
  } else {
    const matrix = await resolveCredentialMatrix(
      envName,
      environment,
      brandPresent,
      orgClientMetadata
    );
    if (matrix.envClient || matrix.orgClient) {
      gates.push({
        id: "credentials",
        status: "ok",
        summary: `CM automation client present (${matrix.envClient ? "env-scoped" : "org-scoped"}).`,
      });
    } else {
      gates.push({
        id: "credentials",
        status: "blocked",
        summary: `No CM automation client for '${envName}' — content reads fail with AUTH_REQUIRED until one is provisioned.`,
        remediation: {
          actor: "needs-human-terminal",
          fix: `scai setup client create ${envName}`,
          detail:
            "Credential minting requires an interactive human terminal; agents and CI callers are refused.",
        },
      });
    }

    // Brand / AI APIs key — org-scoped, required by every brand / brief
    // / campaign / documents / pipeline / review call. Reported as
    // `warn` (non-blocking) because env-tier work (deploy, serialization,
    // publishing, hygiene) does NOT need it; an env preflight should not
    // refuse to be `ready` for an unrelated credential gap. The
    // remediation guides the operator before they hit AUTH_REQUIRED on
    // their first brand-area call.
    if (environment.organizationId && !matrix.brand) {
      gates.push({
        id: "credentials",
        status: "warn",
        summary: `No brand / AI APIs key for org '${environment.organizationId}'. Required for scai brand / brief / campaign / documents / pipeline / review.`,
        remediation: {
          actor: "needs-human-terminal",
          fix: `scai setup client register-brand --org-id ${environment.organizationId}`,
          detail:
            "Registers an AI APIs key (Stream → Admin → AI APIs) against the org so brand-area commands can mint short-lived tokens.",
        },
      });
    }
  }

  const blocking = gates.find((gate) => gate.status === "blocked");
  return {
    environment: envName,
    ready: !blocking,
    gates,
    nextStep: blocking?.remediation,
    humanOnlyOperations: HUMAN_ONLY_OPERATIONS,
  };
};
