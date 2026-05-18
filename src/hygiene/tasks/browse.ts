/**
 * `runContentBrowse` — enumerate the content tree under a path.
 *
 * The plain "what is under here?" read the audits never offered: a
 * bounded-depth walk of item children via the Authoring API, returning
 * each item's name / path / id / template. Answers "what templates (or
 * renderings, or items) do I have under X" in one call, instead of
 * bending a quality audit to the job.
 *
 * Traversal-based — uses `getChildren` (an `item.children` GraphQL
 * query), so it works on environments with no provisioned search index.
 */

import { mapWithConcurrency } from "@/shared/cli-tasks";
import { type HygieneCommonOptions, resolveHygieneKnobs, resolveTenant } from "./shared";

/** Hard ceiling on recursion depth — bounds fan-out on wide trees. */
export const MAX_BROWSE_DEPTH = 5;

export interface ContentBrowseOptions extends HygieneCommonOptions {
  /** Content-tree path to browse, e.g. `/sitecore/templates/Project`. */
  path: string;
  /** Recursion depth — 1 is direct children only. Clamped to [1, MAX_BROWSE_DEPTH]. */
  depth?: number;
}

/** One item in the browse tree. */
export interface BrowseNode {
  itemId: string;
  name: string;
  path: string;
  /** Id of the template this item is based on, or `null` when unknown. */
  templateId: string | null;
  /**
   * Direct children — present when the walk recursed past this node;
   * omitted at the depth limit (re-call `content_browse` deeper to see
   * them).
   */
  children?: BrowseNode[];
}

export interface ContentBrowseResult {
  path: string;
  /** Effective depth after clamping. */
  depth: number;
  nodes: BrowseNode[];
  /** Total items across every level returned. */
  totalCount: number;
}

/**
 * Walk the content tree under `path` to a bounded depth. A non-existent
 * path resolves to an empty `nodes` list (the Authoring API returns no
 * children) rather than throwing.
 */
export const runContentBrowse = async (
  options: ContentBrowseOptions
): Promise<ContentBrowseResult> => {
  const { client } = resolveTenant(options);
  const depth = Math.min(Math.max(1, options.depth ?? 1), MAX_BROWSE_DEPTH);
  // Browse exposes no perf knobs of its own — take the project defaults.
  const knobs = resolveHygieneKnobs({});

  let totalCount = 0;
  const walk = async (
    selector: { path?: string; itemId?: string },
    remaining: number
  ): Promise<BrowseNode[]> => {
    const children = await client.getChildren(selector);
    totalCount += children.length;
    return mapWithConcurrency(
      children,
      async (child): Promise<BrowseNode> => {
        const node: BrowseNode = {
          itemId: child.itemId,
          name: child.name,
          path: child.path,
          templateId: child.templateId,
        };
        if (remaining > 1) {
          node.children = await walk({ itemId: child.itemId }, remaining - 1);
        }
        return node;
      },
      knobs.concurrency
    );
  };

  const nodes = await walk({ path: options.path }, depth);
  return { path: options.path, depth, nodes, totalCount };
};
