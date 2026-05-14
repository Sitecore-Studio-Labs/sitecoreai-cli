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
