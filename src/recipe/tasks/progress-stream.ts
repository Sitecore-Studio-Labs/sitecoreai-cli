import type { ExecutionResult } from "../runtime/execute";

/**
 * Machine-readable per-recipe progress stream for `recipe push`.
 *
 * Orchestrators run the push with `--json`, which suppresses the
 * human per-recipe logging — so a large push is silent for minutes.
 * With `SITECOREAI_PROGRESS_STREAM=1`, the push writes one compact
 * NDJSON line to STDERR as each recipe finishes executing:
 *
 *   {"scaiProgress":1,"recipe":"page-home@1","index":12,"total":237,
 *    "status":"succeeded","summary":{"create":3,"update":8,"skip":4,"error":0}}
 *
 * stderr so the `--json` stdout envelope stays parseable. Consumers
 * (the showcase orchestrator's task runner) tail the stream and turn
 * each line into a live progress event. Off by default — plain CLI
 * runs and older orchestrators are unaffected.
 */

export const progressStreamEnabled = (
  env: Record<string, string | undefined> = process.env
): boolean => env.SITECOREAI_PROGRESS_STREAM === "1";

/** One NDJSON progress line (no trailing newline). Exported for tests. */
export const formatProgressLine = (params: {
  recipeHandle: string;
  /** 1-based position within this push's executed set. */
  index: number;
  total: number;
  result: ExecutionResult;
}): string => {
  const { recipeHandle, index, total, result } = params;
  const failed = result.aborted || result.summary.error > 0;
  return JSON.stringify({
    scaiProgress: 1,
    recipe: recipeHandle,
    index,
    total,
    status: failed ? "failed" : "succeeded",
    summary: {
      create: result.summary.create,
      update: result.summary.update,
      skip: result.summary.skip,
      error: result.summary.error,
    },
  });
};

/** Write one progress line to stderr when the stream is enabled. */
export const writeProgressLine = (params: {
  recipeHandle: string;
  index: number;
  total: number;
  result: ExecutionResult;
}): void => {
  if (!progressStreamEnabled()) return;
  process.stderr.write(`${formatProgressLine(params)}\n`);
};
