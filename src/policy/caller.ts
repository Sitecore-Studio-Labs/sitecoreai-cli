/**
 * Caller context — who is invoking scai *right now*.
 *
 * Phase 2 gates operations on this rather than on stored token
 * provenance: a token is acquired once and reused for weeks, so its
 * birth ("a human logged in") says nothing about the current caller
 * ("an unattended cron is replaying it"). Caller context is computed
 * fresh, per invocation, from the process environment.
 *
 * See docs/policy-and-guardrails.md (Phase 2).
 */

/** Who is invoking scai. */
export type CallerKind = "interactive-human" | "ci" | "m2m" | "mcp";

export interface CallerContext {
  kind: CallerKind;
  /** CI pipeline identifier, when one can be resolved from the environment. */
  pipelineId?: string;
}

/** Env vars that, if set, mean "running inside CI". */
const CI_MARKERS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "TF_BUILD",
] as const;

/** Per-provider env vars carrying a stable pipeline / run identifier. */
const PIPELINE_ID_VARS = [
  "GITHUB_RUN_ID",
  "CI_PIPELINE_ID",
  "CIRCLE_WORKFLOW_ID",
  "BUILDKITE_BUILD_ID",
  "BUILD_BUILDID",
  "TRAVIS_BUILD_ID",
] as const;

const isSet = (key: string): boolean => {
  const value = process.env[key];
  return value !== undefined && value.trim() !== "";
};

const resolvePipelineId = (): string | undefined => {
  for (const key of PIPELINE_ID_VARS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

/**
 * Resolve the current caller context. First match wins, in order:
 * `mcp` → `ci` → `interactive-human` → `m2m`.
 */
export const resolveCallerContext = (): CallerContext => {
  if (isSet("SITECOREAI_MCP_SERVE")) {
    return { kind: "mcp" };
  }
  if (CI_MARKERS.some(isSet)) {
    const pipelineId = resolvePipelineId();
    return pipelineId ? { kind: "ci", pipelineId } : { kind: "ci" };
  }
  const interactive =
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY) &&
    process.env.SITECOREAI_NON_INTERACTIVE !== "1";
  return { kind: interactive ? "interactive-human" : "m2m" };
};
