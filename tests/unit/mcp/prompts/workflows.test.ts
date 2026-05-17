import { describe, expect, it } from "vitest";
import { McpRegistry } from "../../../../src/mcp/registry";
import { registerWorkflowPrompts } from "../../../../src/mcp/prompts/workflows";
import type { McpContext } from "../../../../src/mcp/auth";

/**
 * `registerWorkflowPrompts` registers four guided-workflow prompts on
 * the MCP registry. These tests register them onto a fresh registry,
 * then invoke each prompt's handler and assert the returned message
 * shape — role, content type, and the argument interpolation /
 * branch behaviour each handler implements.
 */

const buildRegistry = (): McpRegistry => {
  const registry = new McpRegistry();
  registerWorkflowPrompts(registry);
  return registry;
};

/** Minimal context stub — the prompt handlers never read from it. */
const context = {} as McpContext;

/** Pull the single user message text out of a prompt handler result. */
const promptText = async (
  registry: McpRegistry,
  name: string,
  args: Record<string, unknown>
): Promise<string> => {
  const descriptor = registry.listPrompts().find((p) => p.name === name);
  if (!descriptor) throw new Error(`prompt '${name}' not registered`);
  const result = await descriptor.handler(args as never, context);
  expect(result.messages).toHaveLength(1);
  const message = result.messages[0];
  expect(message.role).toBe("user");
  expect(message.content.type).toBe("text");
  return message.content.type === "text" ? message.content.text : "";
};

describe("registerWorkflowPrompts — registration", () => {
  it("registers exactly the four workflow prompts", () => {
    const names = buildRegistry()
      .listPrompts()
      .map((p) => p.name);
    expect(names).toEqual([
      "scai.compose_workflow",
      "scai.deploy_recipe",
      "scai.diff_envs",
      "scai.recover_failed_deploy",
    ]);
  });

  it("gives every prompt a non-empty description", () => {
    for (const prompt of buildRegistry().listPrompts()) {
      expect(prompt.description.length, prompt.name).toBeGreaterThan(0);
    }
  });
});

describe("scai.deploy_recipe prompt", () => {
  it("interpolates the recipe name and target env into the guidance", async () => {
    const text = await promptText(buildRegistry(), "scai.deploy_recipe", {
      recipeName: "workflow-blog@1",
      targetEnv: "staging",
    });
    expect(text).toContain("workflow-blog@1");
    expect(text).toContain("staging");
    expect(text).toContain("recipe_compile");
    expect(text).toContain("recipe_push");
  });
});

describe("scai.diff_envs prompt", () => {
  it("interpolates the source and target env names", async () => {
    const text = await promptText(buildRegistry(), "scai.diff_envs", {
      sourceEnv: "dev",
      targetEnv: "prod",
    });
    expect(text).toContain('source: "dev"');
    expect(text).toContain('destination: "prod"');
    expect(text).toContain("serialization_sync");
  });
});

describe("scai.compose_workflow prompt", () => {
  it("embeds the intent and instructs to choose a handle when none is supplied", async () => {
    const text = await promptText(buildRegistry(), "scai.compose_workflow", {
      intent: "Editorial workflow for blog articles.",
    });
    expect(text).toContain("Editorial workflow for blog articles.");
    expect(text).toContain("Choose a stable handle");
  });

  it("uses an explicit handle when one is supplied", async () => {
    const text = await promptText(buildRegistry(), "scai.compose_workflow", {
      intent: "Some intent",
      handle: "blog-article-approval@1",
    });
    expect(text).toContain("Use the handle 'blog-article-approval@1'.");
  });

  it("names the target env confirmation step when targetEnv is supplied", async () => {
    const text = await promptText(buildRegistry(), "scai.compose_workflow", {
      intent: "Some intent",
      targetEnv: "agents",
    });
    expect(text).toContain("The target environment is 'agents'.");
  });

  it("falls back to scai_overview env guidance when targetEnv is omitted", async () => {
    const text = await promptText(buildRegistry(), "scai.compose_workflow", {
      intent: "Some intent",
    });
    expect(text).toContain("scai_overview");
  });
});

describe("scai.recover_failed_deploy prompt", () => {
  it("uses the explicit deployment id when supplied", async () => {
    const text = await promptText(buildRegistry(), "scai.recover_failed_deploy", {
      deploymentId: "dep-123",
    });
    expect(text).toContain('deploymentId: "dep-123"');
    expect(text).toContain("includeLogs: true");
  });

  it("falls back to discovering the most recent failure when no id is supplied", async () => {
    const text = await promptText(buildRegistry(), "scai.recover_failed_deploy", {});
    expect(text).toContain("no `deploymentId`");
    expect(text).toContain("most recent failure");
  });
});
