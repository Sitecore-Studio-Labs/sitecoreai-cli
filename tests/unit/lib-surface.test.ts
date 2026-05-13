/**
 * Verifies the public library surfaces (`./deploy`, `./serialization`,
 * `./errors`, `./recipe`) export the symbols their consumers depend on.
 *
 * Each subpath in `package.json` points at a real source-tree file —
 * no wrapper barrels:
 *
 *   - `./deploy`        → `src/deploy/api/index.ts`
 *   - `./serialization` → `src/serialization/sitecore-api/index.ts`
 *   - `./errors`        → `src/shared/errors.ts`
 *   - `./recipe`        → `src/recipe/index.ts` (unchanged)
 *
 * These are explicit named-export files — every public symbol is
 * intentional. Internal helpers (`startDeploySpinner`,
 * `parseJsonIfPossible`, `extractErrorMessage`) live in sibling
 * modules and are NOT reachable through the public entries.
 */

import { describe, expect, it } from "vitest";

describe("public library surface — /deploy", () => {
  it("exports the canonical Deploy API client functions and types", async () => {
    const lib = await import("../../src/deploy/api/index");

    // Sample functions across each domain.
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

  it("does NOT leak internal request helpers through the public entry", async () => {
    const lib = (await import("../../src/deploy/api/index")) as Record<string, unknown>;

    // These exist in the internal `./common/request` module but the
    // public index does not re-export them. Library consumers shouldn't
    // see them.
    expect(lib.startDeploySpinner).toBeUndefined();
    expect(lib.parseJsonIfPossible).toBeUndefined();
    expect(lib.extractErrorMessage).toBeUndefined();
  });
});

describe("public library surface — /errors", () => {
  it("exports the canonical ScaiError + factory + helpers", async () => {
    const errors = await import("../../src/shared/errors");

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
    const errors = await import("../../src/shared/errors");

    // The class alias points at the same constructor — no separate type.
    expect(errors.CliError).toBe(errors.ScaiError);
    expect(typeof errors.createCliError).toBe("function");
    expect(typeof errors.toCliError).toBe("function");

    const fromLegacy = errors.createCliError("legacy", "INPUT_INVALID");
    expect(fromLegacy).toBeInstanceOf(errors.ScaiError);
    expect(fromLegacy).toBeInstanceOf(errors.CliError);
  });
});

describe("public library surface — /serialization", () => {
  it("exports the Sitecore API client functions, auth primitives, and types", async () => {
    const lib = await import("../../src/serialization/sitecore-api/index");

    // Item operations.
    expect(typeof lib.fetchItemMetadata).toBe("function");
    expect(typeof lib.fetchItemData).toBe("function");
    expect(typeof lib.executeSerializationCommands).toBe("function");

    // History / roles / users / publish.
    expect(typeof lib.fetchHistoryTimestamp).toBe("function");
    expect(typeof lib.fetchRoles).toBe("function");
    expect(typeof lib.fetchUsers).toBe("function");
    expect(typeof lib.publishItems).toBe("function");

    // Auth — both pure (Phase A) and keychain-aware variants.
    expect(typeof lib.acquireAccessToken).toBe("function");
    expect(typeof lib.getAccessToken).toBe("function");
    expect(typeof lib.requestClientCredentialsToken).toBe("function");
    expect(lib.DEFAULT_SITECORE_API_AUDIENCE).toBe("https://api.sitecorecloud.io");

    // Transport seam + canonical types.
    expect(typeof lib.runGraphQL).toBe("function");
    expect(typeof lib.ItemPath).toBe("function");
  });

  it("SitecoreApiClientOptions is structurally satisfied by minimal objects (no full EnvironmentConfiguration needed)", () => {
    // Compile-time check via the type annotation: TypeScript must
    // accept a small literal as the option type, without forcing the
    // consumer to construct a full EnvironmentConfiguration.
    const minimal: import("../../src/serialization/sitecore-api/types").SitecoreApiClientOptions = {
      host: "https://cm.example",
      accessToken: "token",
    };
    expect(minimal.host).toBe("https://cm.example");
    expect(minimal.accessToken).toBe("token");

    // OAuth + client-credentials shape.
    const richer: import("../../src/serialization/sitecore-api/types").SitecoreApiClientOptions = {
      host: "https://cm.example",
      authority: "https://auth.example",
      clientId: "c",
      clientSecret: "s",
      useClientCredentials: true,
      audience: "https://api.example",
    };
    expect(richer.useClientCredentials).toBe(true);
  });
});

describe("public library surface — /recipe (existing export, unchanged)", () => {
  it("recipe export still resolves", async () => {
    const recipe = await import("../../src/recipe/index");
    // The recipe entry has ~80 named exports. Spot-check a few stable ones.
    expect(typeof recipe.compileRecipeSet).toBe("function");
    expect(typeof recipe.buildPlan).toBe("function");
  });
});
