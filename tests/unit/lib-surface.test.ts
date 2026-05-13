/**
 * Verifies the public library surfaces (`./deploy`, `./errors`,
 * `./recipe`) re-export the symbols their consumers depend on.
 *
 * Imports go through the source-tree paths used by package.json's
 * `exports` map after `tsc-alias` rewriting (`./dist/deploy/lib.js`,
 * etc.). At test time the source-tree equivalents are
 * `src/deploy/lib.ts` and `src/shared/lib-errors.ts`. The post-build
 * smoke at `scripts/smoke.cjs` verifies the published-shape resolves
 * end-to-end.
 */

import { describe, expect, it } from "vitest";

describe("public library surface — /deploy", () => {
  it("exports the canonical Deploy API client functions and types", async () => {
    const lib = await import("../../src/deploy/lib");

    // Sample functions across each domain — proves the barrel pulls
    // them through.
    expect(typeof lib.fetchOrganization).toBe("function");
    expect(typeof lib.fetchProjects).toBe("function");
    expect(typeof lib.fetchEnvironments).toBe("function");
    expect(typeof lib.fetchEnvironment).toBe("function");
    expect(typeof lib.probeEnvironmentHealth).toBe("function");
    expect(typeof lib.resolveHostFromEnvironment).toBe("function");
    expect(typeof lib.fetchDeployments).toBe("function");
    expect(typeof lib.fetchSourceControlIntegrations).toBe("function");

    // Transport seam (added in Phase A) is also reachable.
    expect(typeof lib.deployRequest).toBe("function");
    expect(lib.DEFAULT_DEPLOY_API_BASE).toBe("https://xmclouddeploy-api.sitecorecloud.io");
  });
});

describe("public library surface — /errors", () => {
  it("exports the canonical ScaiError + factory + helpers", async () => {
    const errors = await import("../../src/shared/lib-errors");

    expect(typeof errors.ScaiError).toBe("function");
    expect(typeof errors.createScaiError).toBe("function");
    expect(typeof errors.toScaiError).toBe("function");
    expect(typeof errors.withHint).toBe("function");

    const thrown = errors.createScaiError("hello", "NETWORK");
    expect(thrown).toBeInstanceOf(errors.ScaiError);
    expect(thrown.code).toBe("NETWORK");
    expect(thrown.exitCode).toBe(4);
  });

  it("still exports the deprecated CliError aliases (kept for one major)", async () => {
    const errors = await import("../../src/shared/lib-errors");

    // The class alias points at the same constructor — no separate type.
    expect(errors.CliError).toBe(errors.ScaiError);
    expect(typeof errors.createCliError).toBe("function");
    expect(typeof errors.toCliError).toBe("function");

    const fromLegacy = errors.createCliError("legacy", "INPUT_INVALID");
    expect(fromLegacy).toBeInstanceOf(errors.ScaiError);
    expect(fromLegacy).toBeInstanceOf(errors.CliError);
  });
});

describe("public library surface — /recipe (existing export, unchanged)", () => {
  it("recipe export still resolves", async () => {
    const recipe = await import("../../src/recipe/index");
    // The recipe barrel has ~80 named exports. Spot-check a few stable ones.
    expect(typeof recipe.compileRecipeSet).toBe("function");
    expect(typeof recipe.buildPlan).toBe("function");
  });
});
