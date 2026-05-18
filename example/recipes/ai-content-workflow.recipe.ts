import type { WorkflowRecipe } from "@/recipe/schema/recipe";

/**
 * Example: a 3-state review workflow for AI-generated content.
 *
 *   AI Created ──submit──▶ Human Review ──approve──▶ Published (final)
 *                                  └──reject──▶ AI Created
 *
 *   Human Review fires a `notify-reviewer` webhook on entry — that is
 *   the notification that a fresh AI-generated item is waiting for a
 *   human. The `approve` command carries `autoPublish: true`, so the
 *   item publishes as it transitions into Published.
 *
 * Before pushing:
 *   - Replace the placeholder webhook URL with your real endpoint.
 *   - If the endpoint needs auth, add `authorizationPath` (an absolute
 *     path to an item under
 *     /sitecore/system/Settings/Webhooks/Authorizations) or
 *     `authorizationRef` (the handle of a `webhook-authorization`
 *     recipe) to the action. Unauthenticated as written.
 *
 * Push it (no templatesRoot / renderingsRoot config needed — a workflow
 * recipe creates its items under /sitecore/system/Workflows):
 *
 *   scai provision recipe push --input example/recipes/ai-content-workflow.recipe.ts \
 *     --environment-name <env> --what-if      # preview
 *   scai provision recipe push --input example/recipes/ai-content-workflow.recipe.ts \
 *     --environment-name <env> --allow-write  # apply
 *
 * Full reference for fields, payload shape, endpoint contract, and
 * troubleshooting: docs/recipes/workflow.md
 */
export const aiContentWorkflow = {
  kind: "workflow",
  schemaVersion: "1",
  handle: "ai-content-workflow@1",
  name: "AiContentWorkflow",
  displayName: "AI Content Workflow",
  description: "Review workflow for AI-generated content — AI Created, Human Review, Published.",
  meta: { tax: { group: "AI Content" } },
  initialState: "ai-created",
  states: [
    {
      key: "ai-created",
      name: "AICreated",
      displayName: "AI Created",
      commands: [
        {
          key: "submit",
          name: "Submit",
          displayName: "Submit for Review",
          nextState: "human-review",
        },
      ],
    },
    {
      key: "human-review",
      name: "HumanReview",
      displayName: "Human Review",
      // Fires on entry to Human Review — notifies reviewers that a new
      // AI-generated item is waiting. Replace the placeholder URL.
      actions: [
        {
          kind: "webhook-submit",
          key: "notify-reviewer",
          url: "https://example.com/REPLACE-ME/ai-content-review",
        },
      ],
      commands: [
        {
          key: "approve",
          name: "Approve",
          displayName: "Approve & Publish",
          nextState: "published",
          autoPublish: true,
        },
        {
          key: "reject",
          name: "Reject",
          displayName: "Send Back to AI Created",
          nextState: "ai-created",
        },
      ],
    },
    {
      key: "published",
      name: "Published",
      displayName: "Published",
      final: true,
    },
  ],
  bindings: { templates: [] },
} satisfies WorkflowRecipe;
