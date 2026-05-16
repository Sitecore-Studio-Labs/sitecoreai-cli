import { afterAll, beforeAll, expect } from "vitest";
import "../setup";
import { describeIfDeployAuth, getEnv, requireEnv, resolveDeployToken } from "../helpers";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { executeIr, type ExecutionEvent } from "../../../src/recipe/execute";
import { designParametersTemplateId, renderingId, templateId } from "../../../src/recipe/guids";
import { createAuthoringClient } from "../../../src/recipe/api/authoring-client";
import type { AuthoringApiClient } from "../../../src/recipe/api/client";
import type { ComponentTemplateRecipe } from "../../../src/recipe/schema/recipe";

const { describe, it } = describeIfDeployAuth();

/**
 * Sandbox integration test for the cta-button recipe round-trip.
 *
 * Targets the SitecoreAI sandbox tenant defined in the local-dev skill
 * (see plans/scai-recipe-phase-1.md). Gated by SITECOREAI_RUN_INTEGRATION=1
 * AND deploy auth (SITECOREAI_DEPLOY_TOKEN or SITECOREAI_CLIENT_ID +
 * SITECOREAI_CLIENT_SECRET).
 *
 * Uses a unique handle (`recipe-test-cta-<runId>@1`) per test run so
 * concurrent runs don't collide and stale items from prior runs can be
 * cleaned up by GUID. Cleanup runs in `afterAll` and is best-effort —
 * deleting one item never aborts the rest.
 *
 * Required env vars when SITECOREAI_RUN_INTEGRATION=1:
 *   - RECIPE_TEST_CM_HOST              — e.g. https://<tenant>.sitecorecloud.io
 *   - RECIPE_TEST_TEMPLATES_ROOT       — e.g. /sitecore/templates/Project/<site>/Components
 *   - RECIPE_TEST_RENDERINGS_ROOT      — e.g. /sitecore/layout/Renderings/Project/<site>
 */

const RUN_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const HANDLE = `recipe-test-cta-${RUN_ID}@1`;

const buildRecipe = (): ComponentTemplateRecipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle: HANDLE,
  name: `RecipeTestCta${RUN_ID.replace(/-/g, "")}`,
  displayName: `Recipe Test CTA (${RUN_ID})`,
  description: `Integration test recipe — auto-generated, run id ${RUN_ID}.`,
  fields: [
    {
      name: "Link",
      shape: "link",
      sitecore: {
        type: "general-link",
        required: true,
        sortOrder: 100,
      },
    },
  ],
  variants: [{ name: "Default" }, { name: "Outline" }, { name: "Ghost" }, { name: "Link" }],
  params: [
    {
      name: "Size",
      shape: "enum",
      values: ["sm", "md", "lg"],
      default: "md",
      sitecore: {
        type: "droplist",
        sortOrder: 100,
      },
    },
  ],
  rendering: {
    datasourceLocation: "current-item",
    openPropertiesAfterAdd: false,
    otherProperties: { IsAutoDatasourceRendering: "true" },
  },
});

describe("recipe cta-button — sandbox round-trip", () => {
  let client: AuthoringApiClient;
  let templatesRoot: string;
  let renderingsRoot: string;
  let recipe: ComponentTemplateRecipe;

  beforeAll(async () => {
    const accessToken = await resolveDeployToken();
    const cmHost = requireEnv("RECIPE_TEST_CM_HOST");
    templatesRoot =
      getEnv("RECIPE_TEST_TEMPLATES_ROOT") ?? "/sitecore/templates/Project/sandbox/Components";
    renderingsRoot =
      getEnv("RECIPE_TEST_RENDERINGS_ROOT") ?? "/sitecore/layout/Renderings/Project/sandbox";

    const environment: EnvironmentConfiguration = {
      name: "recipe-integration",
      host: cmHost,
      accessToken,
      cacheAuthenticationToken: false,
    };
    client = createAuthoringClient({ environment });
    recipe = buildRecipe();
  });

  afterAll(async () => {
    if (!client) return;
    // Best-effort cleanup. Sitecore deleteItem on a missing item may throw —
    // ignore so a half-completed test still cleans up the rest.
    const ids = [templateId(HANDLE), designParametersTemplateId(HANDLE), renderingId(HANDLE)];
    for (const id of ids) {
      try {
        await client.deleteItem(id);
      } catch {
        // ignore — best-effort
      }
    }
  });

  /**
   * Capture all events so we can surface the underlying GraphQL/auth
   * error if the executor aborts. Without this, vitest just shows
   * "expected true to be false" — useless for debugging real failures.
   */
  const runWithDiagnostics = async (mode: "apply" | "plan") => {
    const ir = compileComponentTemplateRecipe(recipe, { templatesRoot, renderingsRoot });
    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, { mode, emit: (e) => events.push(e) });
    if (result.aborted || result.summary.error > 0) {
      const failedEvent = events.find((e) => e.kind === "failed");
      const applyError = events.find((e) => e.kind === "apply-error");
      const opErrors = events.filter((e) => e.kind === "op-error");
      const rollback = events.filter((e) => e.kind.startsWith("rollback-"));

      console.error("\n=== INTEGRATION TEST FAILURE DIAGNOSTICS ===");

      console.error("mode:", mode, "summary:", result.summary, "aborted:", result.aborted);
      if (failedEvent) console.error("failed:", JSON.stringify(failedEvent, null, 2));
      if (applyError) console.error("apply-error:", JSON.stringify(applyError, null, 2));
      if (opErrors.length > 0) console.error("op-errors:", JSON.stringify(opErrors, null, 2));
      if (rollback.length > 0) console.error("rollback events:", JSON.stringify(rollback, null, 2));

      console.error("=== END DIAGNOSTICS ===\n");
    }
    return { ir, result, events };
  };

  it("first push creates the template, params template, rendering, and variants", async () => {
    const { ir, result } = await runWithDiagnostics("apply");

    expect(result.aborted).toBe(false);
    expect(result.summary.error).toBe(0);
    expect(result.summary.create).toBeGreaterThan(0);

    const tpl = await client.getItem(templateId(HANDLE));
    expect(tpl).not.toBeNull();
    expect(tpl?.itemId.toLowerCase()).toBe(templateId(HANDLE));

    const paramsTpl = await client.getItem(designParametersTemplateId(HANDLE));
    expect(paramsTpl).not.toBeNull();

    const rend = await client.getItem(renderingId(HANDLE));
    expect(rend).not.toBeNull();

    // Force the IR reference into "use" so eslint doesn't complain.
    expect(ir.recipeHandle).toBe(HANDLE);
  });

  it("second push is a no-op (idempotency)", async () => {
    const { ir, result } = await runWithDiagnostics("apply");

    expect(result.aborted).toBe(false);
    expect(result.summary.error).toBe(0);
    expect(result.summary.create).toBe(0);
    expect(result.summary.update).toBe(0);
    expect(result.summary.skip).toBe(ir.operations.length);
  });

  it("--what-if produces a plan against the now-populated tenant with zero create/update", async () => {
    const { ir, result } = await runWithDiagnostics("plan");

    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBe(0);
    expect(result.summary.update).toBe(0);
    expect(result.summary.skip).toBe(ir.operations.length);
  });
});
