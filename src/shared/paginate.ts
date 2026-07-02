/**
 * Cursor-pagination helpers shared across recipe kinds that walk the
 * Orchestrate/Content-Operations list endpoints (which expose no
 * server-side name/label filter, so a full drain is unavoidable).
 *
 * The load-bearing behaviour here is the hang guard: see `drainPages`.
 */

/**
 * Hard ceiling on pages drained from a cursor-paged endpoint. A backstop
 * for a `next` cursor that keeps yielding fresh values forever; a healthy
 * tenant never approaches it.
 */
export const MAX_LIST_PAGES = 10_000;

/**
 * Drain a cursor-paged list endpoint, calling `visit` with each page's
 * rows. `visit` returns a non-`undefined` value to short-circuit (match
 * found); returning `undefined` keeps paging.
 *
 * Terminates on any of: a match, an empty/final page (`next` is null),
 * or — critically — a NON-ADVANCING cursor (the endpoint returned a
 * `next` we already sent). Left unguarded, a malformed/perpetual cursor
 * makes the caller page forever; because each request individually
 * succeeds (and only carries a per-request timeout), the LOOP never
 * terminates and hangs the whole push/pull until the orchestrator's
 * multi-minute spawn timeout kills it. This bit campaign-linked brief
 * pushes via `findProjectIdByLabels` and campaign pulls via
 * `findProjectByName` (single-page lookups never page projects).
 * The guard degrades that infinite loop to a clean "not found" — which
 * every caller already handles non-fatally — and invokes
 * `onNonAdvancingCursor` so the condition is observable in logs.
 */
export const drainPages = async <Row, Hit>(
  fetchPage: (cursor: string | undefined) => Promise<{ data: Row[]; next: string | null }>,
  visit: (rows: Row[]) => Hit | undefined,
  onNonAdvancingCursor?: () => void
): Promise<Hit | undefined> => {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    const hit = visit(result.data);
    if (hit !== undefined) return hit;
    if (!result.next || result.data.length === 0) return undefined;
    if (seenCursors.has(result.next)) {
      onNonAdvancingCursor?.();
      return undefined;
    }
    seenCursors.add(result.next);
    cursor = result.next;
  }
  return undefined;
};
