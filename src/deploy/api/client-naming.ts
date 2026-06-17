/**
 * Naming convention for OAuth clients that scai mints via the Deploy
 * clients API (`./clients.ts`).
 *
 * Every scai-minted client is identifiable in the Cloud Portal clients
 * list by a `scai-` name prefix, and its provenance is recorded in the
 * description. This module is the single source of truth for that
 * convention — every mint call and every "is this ours?" check goes
 * through these helpers rather than hand-building strings.
 *
 * Name shape (stable + deterministic, so a list-then-match yields
 * idempotent reuse — no timestamps):
 *
 *   - environment-scoped: `scai-<type>-<env>`  e.g. `scai-cm-production`
 *   - organization-scoped: `scai-<type>`       e.g. `scai-deploy`
 *
 * The `<env>` segment is the slugified scai environment-profile name.
 */

import { createScaiError } from "../../shared/errors";
import { trimEdgeChar } from "../../shared/strings";

/** The `name`-field prefix that marks a client as scai-managed. */
export const SCAI_CLIENT_PREFIX = "scai-";

/** Client kinds scai can mint. `deploy` is org-scoped; the rest are env-scoped. */
export type ScaiClientType = "cm" | "deploy" | "edge" | "ehbuild";

/** scai surface that triggered the mint — recorded in the description. */
export type ScaiClientSurface = "CLI" | "MCP" | "SDK";

const ENV_SCOPED: ReadonlySet<ScaiClientType> = new Set(["cm", "edge", "ehbuild"]);

const ALL_TYPES: ReadonlySet<string> = new Set(["cm", "deploy", "edge", "ehbuild"]);

const TYPE_LABELS: Record<ScaiClientType, string> = {
  cm: "CM",
  deploy: "Deploy",
  edge: "Edge",
  ehbuild: "Editing-host build",
};

/**
 * Slugify a scai environment-profile name for use in a client name:
 * lowercase, every run of non-alphanumerics collapsed to a single
 * hyphen, leading/trailing hyphens trimmed.
 */
export const slugifyEnvName = (envName: string): string =>
  trimEdgeChar(envName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-");

/**
 * Build the canonical client name for a scai-minted client.
 *
 *   - env-scoped (`cm` | `edge` | `ehbuild`) → `scai-<type>-<env>`;
 *     `envName` is required.
 *   - org-scoped (`deploy`) → `scai-deploy`; `envName` is ignored.
 *
 * Throws `INPUT_INVALID` if an env-scoped type is given without a
 * usable `envName`.
 */
export const buildScaiClientName = (type: ScaiClientType, envName?: string): string => {
  if (!ENV_SCOPED.has(type)) {
    return `${SCAI_CLIENT_PREFIX}${type}`;
  }
  const slug = envName ? slugifyEnvName(envName) : "";
  if (!slug) {
    throw createScaiError(
      `Cannot build a client name: '${type}' is environment-scoped and needs an environment name.`,
      "INPUT_INVALID",
      { hint: "Pass the scai environment-profile name as the second argument." }
    );
  }
  return `${SCAI_CLIENT_PREFIX}${type}-${slug}`;
};

export interface BuildScaiClientDescriptionOptions {
  /** Which scai surface minted the client. */
  surface: ScaiClientSurface;
  /** scai package version, e.g. "0.0.4". */
  version: string;
  /** Environment-profile name — for env-scoped clients. */
  envName?: string;
}

/**
 * The Deploy clients API caps the `description` field at 140 characters
 * — `POST /api/clients/v1/*` rejects anything longer as a validation
 * error. `buildScaiClientDescription` keeps its output within this.
 */
export const CLIENT_DESCRIPTION_MAX_LENGTH = 140;

/**
 * Build the human-readable provenance string for a scai-minted client's
 * `description` field — records the surface, version, scope, and that
 * the credential is safe to delete.
 *
 * Stays within `CLIENT_DESCRIPTION_MAX_LENGTH`, truncating as a
 * defensive backstop for pathologically long env-profile names. The
 * project id and creation date are deliberately omitted: the clients
 * API records `createdAt` itself, and the project is already encoded in
 * the client name (`scai-cm-<env>`).
 */
export const buildScaiClientDescription = (
  type: ScaiClientType,
  options: BuildScaiClientDescriptionOptions
): string => {
  const lead = `Managed by scai ${options.surface} v${options.version}.`;
  const scope = ENV_SCOPED.has(type)
    ? `${TYPE_LABELS[type]} client for ${
        options.envName ? `environment '${options.envName}'` : "an environment"
      }.`
    : `${TYPE_LABELS[type]} client for the organization.`;
  const tail = "Safe to delete if scai is unused.";
  const full = `${lead} ${scope} ${tail}`;
  if (full.length <= CLIENT_DESCRIPTION_MAX_LENGTH) {
    return full;
  }
  // Defensive: a very long env-profile name can still blow the cap.
  return `${full.slice(0, CLIENT_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
};

/** True if `name` carries the scai-managed prefix. */
export const isScaiManagedClient = (name: string | null | undefined): boolean =>
  typeof name === "string" && name.startsWith(SCAI_CLIENT_PREFIX);

/**
 * Parse a client name back into its `{ type, envName? }` parts, or
 * `null` if it is not a canonically-formed scai-managed name.
 *
 * Round-trips with `buildScaiClientName` — note `envName` comes back
 * slugified (the name only ever stored the slug).
 */
export const parseScaiClientName = (
  name: string | null | undefined
): { type: ScaiClientType; envName?: string } | null => {
  if (!isScaiManagedClient(name)) {
    return null;
  }
  const rest = (name as string).slice(SCAI_CLIENT_PREFIX.length);
  const dash = rest.indexOf("-");
  const typeToken = dash === -1 ? rest : rest.slice(0, dash);
  const envToken = dash === -1 ? "" : rest.slice(dash + 1);
  if (!ALL_TYPES.has(typeToken)) {
    return null;
  }
  const type = typeToken as ScaiClientType;
  if (ENV_SCOPED.has(type)) {
    // Env-scoped names must carry a non-empty env segment.
    return envToken ? { type, envName: envToken } : null;
  }
  // Org-scoped names must NOT carry a trailing segment.
  return envToken ? null : { type };
};
