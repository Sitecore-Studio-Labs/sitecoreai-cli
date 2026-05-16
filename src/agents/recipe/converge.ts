/**
 * Shared diff for **create-only** recipe kinds.
 *
 * skill, widget, and custom-mcp have a verified create endpoint but no
 * verified update — so, like `campaign`'s create-only project, a recipe
 * creates the resource when absent and leaves an existing one untouched
 * (a `noop`, surfaced so the operator sees it was not converged).
 */
import type { RecipePlan } from "@/sync";

/** Diff for a create-only kind: `create` when absent, otherwise `noop`. */
export const diffCreateOnly = <T>(
  kindLabel: string,
  name: string,
  desired: T,
  current: T | null
): RecipePlan => {
  const path = `${kindLabel}.${name}`;
  if (!current) {
    return {
      changes: [
        {
          kind: "create",
          path,
          summary: `create ${kindLabel} "${name}"`,
          after: desired,
          meta: { recipe: desired },
        },
      ],
    };
  }
  return {
    changes: [
      {
        kind: "noop",
        path,
        summary: `${kindLabel} "${name}" already exists — create-only kind, not updated`,
        before: current,
        after: desired,
      },
    ],
  };
};
