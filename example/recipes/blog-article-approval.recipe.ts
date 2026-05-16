import type { WorkflowRecipe } from "@/recipe/schema/recipe";

/**
 * Example: a 3-state editorial workflow with webhook hooks.
 *
 *   Draft ──submit──▶ In Review ──approve──▶ Approved (final)
 *                           └──reject──▶ Draft
 *
 *   In Review fires a `notify-reviewer` webhook on entry. The
 *   `approve` command runs a `lint-content` validation webhook
 *   (synchronous gate) before transitioning. Approved fires a
 *   `publish-trigger` webhook on entry.
 *
 *   `autoPublish: true` on `approve` flips Sitecore's standard
 *   __Auto Publish field — the item auto-publishes on transition.
 *
 * Full reference for fields, payload shape, endpoint contract, and
 * troubleshooting: docs/recipes/workflow.md
 */
export const blogArticleApproval = {
  kind: "workflow",
  schemaVersion: "1",
  handle: "blog-article-approval@1",
  name: "BlogArticleApproval",
  displayName: "Blog Article Approval",
  description: "Editorial workflow for blog articles — draft, review, approve.",
  meta: { tax: { group: "Editorial" } },
  initialState: "draft",
  states: [
    {
      key: "draft",
      name: "Draft",
      displayName: "Draft",
      commands: [
        {
          key: "submit",
          name: "Submit",
          displayName: "Submit for Review",
          nextState: "in-review",
        },
      ],
    },
    {
      key: "in-review",
      name: "InReview",
      displayName: "In Review",
      actions: [
        {
          kind: "webhook-submit",
          key: "notify-reviewer",
          url: "https://hooks.example.com/notify-reviewer",
          authorizationRef: "ci-bearer@1",
        },
      ],
      commands: [
        {
          key: "approve",
          name: "Approve",
          displayName: "Approve",
          nextState: "approved",
          autoPublish: true,
          validations: [
            {
              kind: "webhook-validation",
              key: "lint-content",
              url: "https://hooks.example.com/lint-content",
              authorizationRef: "ci-bearer@1",
            },
          ],
        },
        {
          key: "reject",
          name: "Reject",
          displayName: "Reject",
          nextState: "draft",
        },
      ],
    },
    {
      key: "approved",
      name: "Approved",
      displayName: "Approved",
      final: true,
      actions: [
        {
          kind: "webhook-submit",
          key: "publish-trigger",
          url: "https://hooks.example.com/publish-trigger",
          authorizationRef: "ci-bearer@1",
        },
      ],
    },
  ],
  bindings: { templates: [] },
} satisfies WorkflowRecipe;
