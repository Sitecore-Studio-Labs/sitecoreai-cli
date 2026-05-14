/**
 * MCP Prompts — slash-command-style templates surfaced by compatible
 * clients. Each prompt returns a single user-role message that
 * instructs the agent how to chain the registered tools to accomplish
 * a higher-level workflow.
 *
 * The prompts are intentionally instruction text, not tool routing —
 * the agent reads the message and dispatches the tools itself. This
 * keeps the prompt layer transport-agnostic and easy to update without
 * code changes elsewhere.
 */

import { z } from "zod";
import type { McpRegistry } from "../registry";

export const registerWorkflowPrompts = (registry: McpRegistry): void => {
  registry.registerPrompt({
    name: "scai.deploy_recipe",
    description:
      "Guided workflow: compile a recipe, plan it, diff it, and push it to the target environment with explicit confirmations.",
    argsSchema: {
      recipeName: z.string().describe("Recipe handle or file path."),
      targetEnv: z.string().describe("Target environment name."),
    },
    handler: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Deploy recipe '${args.recipeName}' to environment '${args.targetEnv}'.`,
              "",
              "Step 1. Call `recipe_compile` with `inputPath: <path to recipe>` to produce the IR.",
              "Step 2. Call `recipe_diff` with `inputPath: <same path>` to surface the planned changes. Show the diff to the user.",
              "Step 3. Get explicit user confirmation before mutating the tenant.",
              "Step 4. Call `recipe_push` with `inputPath: <same path>`, `whatIf: false`, `allowWrite: true`.",
              "Step 5. Summarize the apply result back to the user (succeeded / aborted counts, any rollback).",
              "",
              "Abort early if step 2 surfaces destructive changes the user did not expect. Never set `allowWrite: true` without an explicit user confirmation in this turn.",
            ].join("\n"),
          },
        },
      ],
    }),
  });

  registry.registerPrompt({
    name: "scai.diff_envs",
    description:
      "Guided workflow: diff serialized items between two environments, summarize, and propose next steps.",
    argsSchema: {
      sourceEnv: z.string().describe("Source environment name."),
      targetEnv: z.string().describe("Target environment name."),
    },
    handler: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Diff serialized state between '${args.sourceEnv}' and '${args.targetEnv}'.`,
              "",
              `Step 1. Call \`serialization_sync\` with \`direction: "diff"\`, \`source: "${args.sourceEnv}"\`, \`destination: "${args.targetEnv}"\`, \`pushOnDiff: false\`. Do NOT pass allowWrite.`,
              "Step 2. Summarize the diff for the user — count of items added, modified, removed.",
              `Step 3. If the user wants to push the diff to '${args.targetEnv}', re-call the tool with \`pushOnDiff: true\` AND \`allowWrite: true\` (only after explicit confirmation).`,
            ].join("\n"),
          },
        },
      ],
    }),
  });

  registry.registerPrompt({
    name: "scai.compose_workflow",
    description:
      "Guided workflow: design a Sitecore workflow from a natural-language description, emit a recipe, and walk the user through dry-run + apply.",
    argsSchema: {
      intent: z
        .string()
        .describe(
          "Plain-English description of the workflow's purpose, the states it should have, and the webhook hooks (if any). Example: 'Editorial workflow for blog articles. Draft → In Review → Approved. In Review notifies a Slack channel; approval runs a lint webhook; Approved auto-publishes.'"
        ),
      handle: z
        .string()
        .optional()
        .describe(
          "Recipe handle, format `<kebab-name>@<major>`. The agent should propose a sensible one if omitted (e.g. `blog-article-approval@1`)."
        ),
      targetEnv: z
        .string()
        .optional()
        .describe("Environment to push to. When omitted, uses the bound env."),
    },
    handler: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Compose a workflow recipe from this intent:`,
              "",
              `> ${args.intent}`,
              "",
              args.handle
                ? `Use the handle '${args.handle}'.`
                : "Choose a stable handle in `<kebab-name>@<major>` form and tell the user what you chose + why.",
              "",
              "Step 1. **Read the reference first.** Call `resources/read` with `uri: 'scai://help/recipes-workflow'`. The reference covers the runtime model, recipe schema for both `workflow` and `webhook-authorization` kinds, authorization types + the `$ENV:VAR` secret-ref pattern, content-tree mapping, and failure modes.",
              "",
              "Step 2. **Verify the tenant supports webhook-action templates** before designing actions. Call `workflow_inspect verb='inspect' item: 'Sample Workflow'`. If the response's `result.definition.states[].actions[]` contains items templated `Webhook Submit Action` or `Webhook Validation Action`, the tenant supports webhook actions. If not, design WITHOUT `actions`/`validations`.",
              "",
              "Step 3. **Plan the workflow shape with the user before writing code.** Confirm:",
              "  - State keys + display names (kebab-case keys; need at least one `final: true`)",
              "  - Commands per state + their `nextState` targets",
              "  - For each webhook action: URL, kind (submit vs validation), authorization choice",
              "",
              "Step 4. **Emit the recipe.** Construct a `WorkflowRecipe` object literal matching the schema. If the design uses webhook authorizations not already on the tenant, also emit one or more `WebhookAuthorizationRecipe` objects. Don't write to disk yourself — present the TypeScript to the user and ask where they want it saved (typically `recipes/workflows/<handle>.recipe.ts`).",
              "",
              "Step 5. **Dry-run via the recipe MCP tools**:",
              "  - `recipe_compile` with the file path to confirm it parses to the expected IR.",
              "  - `recipe_diff` to surface what would change against the tenant.",
              "  - Show the IR + diff to the user.",
              "",
              "Step 6. **Apply on explicit confirmation only**:",
              args.targetEnv
                ? `  - The target environment is '${args.targetEnv}'. Confirm with the user before pushing.`
                : "  - Confirm the target environment is what the user expects (check the bound env via `scai_overview`).",
              "  - Call `recipe_push` with `inputPath: <file>`, `whatIf: false`, `allowWrite: true`.",
              "  - Show the per-op apply summary back to the user.",
              "",
              "Step 7. **Verify** by calling `workflow_inspect verb='inspect' item: '<displayName>'`. Walk the user through the state tree the response returns.",
              "",
              "Guardrails:",
              "- Never set `allowWrite: true` without an explicit user confirmation in this turn.",
              "- If a planned action's `authorizationRef` resolves nothing, abort and ask whether to (a) author a `webhook-authorization` recipe, (b) point at a tenant-side path via `authorizationPath`, or (c) drop authorization for now.",
              "- Recommend `webhook-validation` for synchronous gates (data quality, approval) and `webhook-submit` for one-way notifications (Slack, publish triggers).",
            ].join("\n"),
          },
        },
      ],
    }),
  });

  registry.registerPrompt({
    name: "scai.recover_failed_deploy",
    description:
      "Guided workflow: inspect the last failed deployment, pull its logs, and present a remediation plan.",
    argsSchema: {
      deploymentId: z
        .string()
        .optional()
        .describe(
          "Specific failed deployment id. When omitted, uses the most recent failed deploy."
        ),
    },
    handler: async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Diagnose and remediate a failed XM Cloud deployment.",
              "",
              args.deploymentId
                ? `Step 1. Call \`deploy_run_inspect\` with \`deploymentId: "${args.deploymentId}"\`, \`includeLogs: true\`.`
                : "Step 1. Call `deploy_run_inspect` with no `deploymentId` to list recent deploys; identify the most recent failure; then call again with that deployment's id and `includeLogs: true`.",
              "Step 2. Read the logs and summarize the failure cause for the user.",
              "Step 3. Propose a remediation. Common patterns:",
              "  - Bad env variable → `deploy_environment_variables action=upsert` (allowWrite, with confirmation).",
              "  - Stale context → `deploy_environment_lifecycle action=regenerate-context` (allowWrite, with confirmation).",
              "  - Re-run the deployment → `deploy_run_start` with the same environmentId.",
              "Step 4. Wait for explicit user confirmation before any allowWrite step.",
            ].join("\n"),
          },
        },
      ],
    }),
  });
};
