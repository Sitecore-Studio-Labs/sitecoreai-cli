/**
 * Zod schemas validating the on-disk policy JSON.
 *
 * Two artifacts (see docs/policy-and-guardrails.md):
 *   - the user-global workspace policy (`~/.sitecoreai/policy.json`)
 *   - the optional repo policy (`<repo>/scai.policy.json`)
 *
 * The hand-derived TypeScript shapes live in `./types`, inferred from
 * these schemas so the two can never drift.
 */

import { z } from "zod";
import { createScaiError } from "@/shared/errors";

/** Operation risk tiers, ascending. See `./types` for the ordering helpers. */
export const riskTierSchema = z.enum(["read", "write", "destructive", "mint"]);

/** How an environment came to be enrolled — surfaced by `scai policy show`. */
export const enrollSourceSchema = z.enum([
  "setup-login",
  "mcp-serve",
  "setup-init",
  "policy-init",
  "policy-allow",
]);

/**
 * The pinned tenant identity of an enrolled environment. Every field is
 * optional — an org-level profile has no project/environment — and
 * enforcement compares only the fields the pin actually carries.
 */
export const envIdentitySchema = z.object({
  organizationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
});

export const policyEnvironmentSchema = z.object({
  identity: envIdentitySchema,
  ceiling: riskTierSchema,
  enrolledAt: z.string().min(1),
  enrolledVia: enrollSourceSchema,
  /** Phase 2 — may `scai setup client create` mint a client here. */
  mintCredentials: z.boolean().optional(),
  /** Phase 2 — may a CI caller perform write/destructive ops here. */
  ciWrites: z.boolean().optional(),
  /** Phase 3 — destructive/mint ops require a deploy token minted within this many minutes. */
  stepUpMinutes: z.number().int().positive().optional(),
});

/** The user-global workspace policy — the hard ceiling. */
export const workspacePolicySchema = z.object({
  version: z.literal(1),
  environments: z.record(z.string(), policyEnvironmentSchema),
});

/**
 * The optional repo policy. May only NARROW the workspace policy — drop
 * environments from the allowlist, lower ceilings — never widen.
 */
export const repoPolicySchema = z.object({
  version: z.literal(1),
  allowEnvironments: z.array(z.string().min(1)).optional(),
  environments: z
    .record(
      z.string(),
      z.object({
        ceiling: riskTierSchema.optional(),
        mintCredentials: z.boolean().optional(),
        ciWrites: z.boolean().optional(),
        stepUpMinutes: z.number().int().positive().optional(),
      })
    )
    .optional(),
});

const formatIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

export const parseWorkspacePolicy = (raw: unknown, source: string) => {
  const result = workspacePolicySchema.safeParse(raw);
  if (!result.success) {
    throw createScaiError(`Invalid workspace policy at ${source}.`, "CONFIG_INVALID", {
      hint: "Fix the file, or run 'scai policy init' to regenerate it.",
      details: formatIssues(result.error),
    });
  }
  return result.data;
};

export const parseRepoPolicy = (raw: unknown, source: string) => {
  const result = repoPolicySchema.safeParse(raw);
  if (!result.success) {
    throw createScaiError(`Invalid repo policy at ${source}.`, "CONFIG_INVALID", {
      hint: "Fix scai.policy.json — it may only narrow the workspace policy.",
      details: formatIssues(result.error),
    });
  }
  return result.data;
};
