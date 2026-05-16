/**
 * The pure diff for the `agent` recipe kind — desired recipe vs captured
 * current state → a `RecipePlan`. No I/O, so it is the testable core.
 *
 * An agent is a single object (no nested children, unlike a campaign),
 * so a plan holds exactly one change: `create`, `update`, or `noop`. The
 * change carries the recipe on `meta.recipe` so `apply` need not re-parse.
 */
import { isDeepStrictEqual } from "node:util";
import type { RecipePlan } from "@/sync";
import type { AgentRecipe } from "./agent.schema";

/** Diff a desired agent recipe against captured current state. */
export const diffAgent = (desired: AgentRecipe, current: AgentRecipe | null): RecipePlan => {
  const path = `agent.${desired.name}`;

  if (!current) {
    return {
      changes: [
        {
          kind: "create",
          path,
          summary: `create agent "${desired.name}"`,
          after: desired,
          meta: { recipe: desired },
        },
      ],
    };
  }

  if (isDeepStrictEqual(desired, current)) {
    return {
      changes: [
        {
          kind: "noop",
          path,
          summary: `agent "${desired.name}" already up to date`,
          before: current,
          after: desired,
        },
      ],
    };
  }

  return {
    changes: [
      {
        kind: "update",
        path,
        summary: `update agent "${desired.name}"`,
        before: current,
        after: desired,
        meta: { recipe: desired },
      },
    ],
  };
};
