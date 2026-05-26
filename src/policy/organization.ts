/**
 * Shared organization-resolution helper — the org-scoped counterpart to
 * `resolveEnvironment` in `./environment.ts`.
 *
 * `brief`, `campaign`, and `brand` act on a Sitecore **organization**,
 * not an XM Cloud **environment**: their APIs are org-keyed (one brand
 * credential per org, one region per org, briefs/campaigns live at org
 * scope). They must not require `--environment-name` / `defaultEnvProfile`
 * the way `resolveEnvironment` does — an operator with a single
 * environment, or none at all, should still be able to run them.
 *
 * This consolidates the resolution `brand/credential.ts` already did
 * inline (`resolveBrandOrgId`) so brief and campaign get the same
 * behaviour instead of dragging in the env-requiring resolver purely to
 * read `environment.organizationId`.
 *
 * Workspace-policy gating: runs `enforceOrganizationPolicy` once the
 * orgId is resolved — the org-scoped counterpart of the env-scoped gate
 * inside `resolveEnvironment`. Closes the prior bypass where brand /
 * brief / campaign retargeted any orgId without an allowlist check.
 * `skipPolicy` is the same escape hatch used by `setup` / `policy`
 * commands and `mcp serve` startup.
 */

import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { enforceOrganizationPolicy } from "./organization-policy";

export interface ResolveOrganizationOptions {
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
  /** Explicit organization id (e.g. from `--org-id`). Highest priority. */
  orgId?: string;
  /** Explicit env profile name (e.g. from `-n` / `--environment-name`). */
  environmentName?: string;
  /**
   * Skip the workspace-policy gate (`enforceOrganizationPolicy`). Used
   * by paths that run *before* an org is enrolled — `scai mcp serve`
   * startup, the `setup` / `policy` commands. Everything that touches
   * tenant data leaves this unset, so the gate is on by default.
   */
  skipPolicy?: boolean;
}

export interface ResolvedOrganization {
  /** The resolved Sitecore organization id. */
  orgId: string;
  /** The full root configuration. */
  root: RootConfiguration;
  /**
   * An env profile belonging to `orgId`, when one exists — the env that
   * was explicitly named, else the first profile carrying this org.
   * `undefined` when the org was resolved purely from `--org-id` (or the
   * sole `brand` entry) and no env profile references it. Consumers that
   * need an env-scoped automation client read this; those that only need
   * the org id ignore it.
   */
  environment?: EnvironmentConfiguration;
  /** Name of `environment`, when one was resolved. */
  envName?: string;
}

/**
 * Resolve the Sitecore organization an org-scoped command should act on.
 *
 * Resolution order:
 *   1. Explicit `orgId` (`--org-id`).
 *   2. The explicitly named env profile's `organizationId` (`-n` or a
 *      configured `defaultEnvProfile`) — a named env is authoritative.
 *   3. The first env profile that carries an `organizationId` — so a
 *      single-environment config resolves with no flag and no default.
 *   4. The sole `brand[orgId]` credential entry, when exactly one exists.
 *
 * Throws `INPUT_INVALID` when none yields an org id, and `ENV_NOT_FOUND`
 * when an explicitly named env profile does not exist.
 */
export const resolveOrganization = (options: ResolveOrganizationOptions): ResolvedOrganization => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const configRootDir = rootFile.rootDir;
  const root = readRootConfiguration(configPath, options.environmentName);
  const environments = root.environments;
  const gate = (orgId: string): void => {
    if (!options.skipPolicy) {
      enforceOrganizationPolicy({ orgId, configRootDir });
    }
  };
  // `defaultEnvProfile` is the raw config value (undefined when unset) —
  // distinct from `defaultEnvironment`, which collapses an unset default
  // to the literal "default". Only a real flag or configured default
  // counts as a "named" env.
  const namedEnvName = options.environmentName ?? root.defaultEnvProfile;

  /** Pick a representative env profile for an org — named env first. */
  const envForOrg = (
    orgId: string
  ): { envName?: string; environment?: EnvironmentConfiguration } => {
    if (namedEnvName && environments[namedEnvName]?.organizationId === orgId) {
      return { envName: namedEnvName, environment: environments[namedEnvName] };
    }
    const match = Object.entries(environments).find(([, env]) => env.organizationId === orgId);
    return match ? { envName: match[0], environment: match[1] } : {};
  };

  // 1. Explicit --org-id.
  if (options.orgId) {
    gate(options.orgId);
    return { orgId: options.orgId, root, ...envForOrg(options.orgId) };
  }

  // 2. Named env profile — authoritative. We never fall through to a
  //    different profile's org behind the operator's back.
  if (namedEnvName) {
    const named = environments[namedEnvName];
    if (!named) {
      throw createScaiError(`Environment '${namedEnvName}' is not configured.`, "ENV_NOT_FOUND", {
        hint: "Run 'scai setup init' to configure the environment, or pass --org-id.",
      });
    }
    if (named.organizationId) {
      gate(named.organizationId);
      return { orgId: named.organizationId, root, envName: namedEnvName, environment: named };
    }
    throw createScaiError(`Environment '${namedEnvName}' has no organizationId.`, "INPUT_INVALID", {
      hint: "Pass --org-id <id>, or set organizationId on the env profile.",
    });
  }

  // 3. First env profile carrying an organizationId.
  const fromProfile = Object.entries(environments).find(([, env]) => Boolean(env.organizationId));
  if (fromProfile && fromProfile[1].organizationId) {
    gate(fromProfile[1].organizationId);
    return {
      orgId: fromProfile[1].organizationId,
      root,
      envName: fromProfile[0],
      environment: fromProfile[1],
    };
  }

  // 4. The sole brand credential entry.
  const brandOrgIds = Object.keys(root.brand ?? {});
  if (brandOrgIds.length === 1) {
    gate(brandOrgIds[0]);
    return { orgId: brandOrgIds[0], root, ...envForOrg(brandOrgIds[0]) };
  }

  throw createScaiError("Cannot resolve an organization for this command.", "INPUT_INVALID", {
    hint: "Pass --org-id <id>, or set organizationId on an env profile in sitecoreai.cli.json.",
  });
};
