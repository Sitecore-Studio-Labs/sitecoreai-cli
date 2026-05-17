import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCallerContext } from "../../../src/policy";

/** Every env var `resolveCallerContext` consults — cleared per test for determinism. */
const TOUCHED_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "TF_BUILD",
  "GITHUB_RUN_ID",
  "CI_PIPELINE_ID",
  "CIRCLE_WORKFLOW_ID",
  "BUILDKITE_BUILD_ID",
  "BUILD_BUILDID",
  "TRAVIS_BUILD_ID",
  "SITECOREAI_MCP_SERVE",
  "SITECOREAI_NON_INTERACTIVE",
];

let saved: Record<string, string | undefined>;
let savedStdin: unknown;
let savedStdout: unknown;

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  savedStdin = process.stdin.isTTY;
  savedStdout = process.stdout.isTTY;
});

afterEach(() => {
  for (const key of TOUCHED_VARS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  (process.stdin as { isTTY?: unknown }).isTTY = savedStdin;
  (process.stdout as { isTTY?: unknown }).isTTY = savedStdout;
});

const setTty = (value: boolean): void => {
  (process.stdin as { isTTY?: unknown }).isTTY = value;
  (process.stdout as { isTTY?: unknown }).isTTY = value;
};

describe("resolveCallerContext", () => {
  it("detects mcp first — even when CI markers and a TTY are also present", () => {
    process.env.SITECOREAI_MCP_SERVE = "1";
    process.env.GITHUB_ACTIONS = "true";
    setTty(true);
    expect(resolveCallerContext().kind).toBe("mcp");
  });

  it("detects ci and resolves a pipeline id", () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_RUN_ID = "run-123";
    const ctx = resolveCallerContext();
    expect(ctx.kind).toBe("ci");
    expect(ctx.pipelineId).toBe("run-123");
  });

  it("detects interactive-human on a TTY with no CI / MCP markers", () => {
    setTty(true);
    expect(resolveCallerContext().kind).toBe("interactive-human");
  });

  it("treats SITECOREAI_NON_INTERACTIVE on a TTY as m2m", () => {
    setTty(true);
    process.env.SITECOREAI_NON_INTERACTIVE = "1";
    expect(resolveCallerContext().kind).toBe("m2m");
  });

  it("detects m2m with no TTY and no CI / MCP markers", () => {
    setTty(false);
    expect(resolveCallerContext().kind).toBe("m2m");
  });
});
