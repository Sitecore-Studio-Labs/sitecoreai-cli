import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `pnpm check` is the pre-push gate. This asserts it actually covers what CI
// runs, so "check is green" means something.
//
// It did not. `check` omitted `docs:commands:check`, so a script that CI runs
// was never exercised locally — and when `"type": "module"` landed, the
// `__dirname` in `scripts/generate-commands-doc.ts` broke, passed a green local
// `check`, and failed both build jobs on the PR. The fix for one script is a
// one-liner; the fix for the CLASS is this test.
//
// Anything CI runs is either in `check` or in CI_ONLY below with a stated
// reason. There is no third option, and the list cannot rot silently: a
// separate test fails if an entry stops being CI-only.

const ROOT = resolve(__dirname, "..", "..", "..");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const ciYaml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** npm scripts CI invokes via `run: npm run <name>`. */
const ciScripts = (): string[] => [
  ...new Set([...ciYaml.matchAll(/run:\s*npm run ([a-z:]+)/g)].map((m) => m[1])),
];

/** Scripts `pnpm check` chains together. */
const checkScripts = (): string[] => [
  ...new Set([...pkg.scripts.check.matchAll(/pnpm ([a-z:]+)/g)].map((m) => m[1])),
];

/**
 * CI steps deliberately outside `check`, each with the reason it is safe to
 * leave out of the fast local loop.
 */
const CI_ONLY: Record<string, string> = {
  // `pnpm smoke` runs `npm run build` as its first step, and smoke is the
  // gate anyone touching the build is expected to run. Duplicating a full
  // clean build inside `check` would roughly double its runtime for no
  // additional signal.
  build: "covered by `pnpm smoke`, which builds first",
  // `check` runs `test`, so the tests themselves are covered. The delta is
  // only the coverage thresholds, which are a ratchet CI owns —
  // `coverage:ratchet` exists for running it deliberately.
  "test:coverage": "`check` runs `test`; the threshold ratchet is CI's job",
};

describe("pnpm check covers what CI runs", () => {
  it("every CI script is in `check` or explicitly CI-only", () => {
    const inCheck = new Set(checkScripts());
    const uncovered = ciScripts()
      .filter((s) => !inCheck.has(s) && !(s in CI_ONLY))
      .sort();
    expect(
      uncovered,
      "CI runs these but `pnpm check` does not — add them to `check`, or to " +
        "CI_ONLY with a reason. A pre-push gate that silently omits a CI step " +
        "is how a green local run ships a red PR."
    ).toEqual([]);
  });

  it("CI_ONLY entries are still CI steps", () => {
    const ci = new Set(ciScripts());
    const stale = Object.keys(CI_ONLY)
      .filter((s) => !ci.has(s))
      .sort();
    expect(stale, "CI no longer runs these — drop them from CI_ONLY").toEqual([]);
  });

  it("CI_ONLY entries are not also in `check`", () => {
    // If one gets added to `check`, the exemption is obsolete and its stated
    // reason is now false.
    const inCheck = new Set(checkScripts());
    const redundant = Object.keys(CI_ONLY)
      .filter((s) => inCheck.has(s))
      .sort();
    expect(redundant, "`check` covers these now — drop them from CI_ONLY").toEqual([]);
  });

  it("every script named in `check` and CI actually exists", () => {
    const missing = [...new Set([...checkScripts(), ...ciScripts()])]
      .filter((s) => !(s in pkg.scripts))
      .sort();
    expect(missing, "named in check/ci.yml but not defined in package.json").toEqual([]);
  });

  it("parses a non-trivial number of scripts from both sides", () => {
    // Guards the guard: if either regex stops matching, every assertion above
    // passes vacuously over an empty set.
    expect(ciScripts().length).toBeGreaterThanOrEqual(5);
    expect(checkScripts().length).toBeGreaterThanOrEqual(5);
  });
});
