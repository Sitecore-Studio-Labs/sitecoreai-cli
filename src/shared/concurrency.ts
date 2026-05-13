/**
 * Bounded-concurrency async iteration helper. Used to parallelize
 * I/O-bound network calls (e.g. `fetchItemData` for each item in a
 * serialization pull) without blasting unbounded request fans out at
 * Sitecore — which would hit rate limits, exhaust local sockets, or
 * blow up memory holding too many in-flight Response bodies.
 *
 * Results preserve input order. The first failure aborts: pending
 * tasks are not started, in-flight tasks are awaited then their
 * results discarded.
 *
 * Default concurrency is 8 (conservative for typical XM Cloud rate
 * limits). Override via `SITECOREAI_HTTP_CONCURRENCY`.
 */

export const DEFAULT_CONCURRENCY = 8;

export const resolveDefaultConcurrency = (): number => {
  const raw = process.env.SITECOREAI_HTTP_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return Math.floor(parsed);
};

export interface MapWithConcurrencyOptions {
  concurrency?: number;
}

export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: MapWithConcurrencyOptions = {}
): Promise<R[]> => {
  const limit = Math.max(1, options.concurrency ?? resolveDefaultConcurrency());
  if (items.length === 0) return [];
  if (limit >= items.length) {
    return Promise.all(items.map((item, index) => worker(item, index)));
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let aborted = false;
  let firstError: unknown = undefined;

  const run = async (): Promise<void> => {
    while (!aborted) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (!aborted) {
          aborted = true;
          firstError = error;
        }
        return;
      }
    }
  };

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < limit; i++) {
    workers.push(run());
  }
  await Promise.all(workers);
  if (aborted) {
    throw firstError;
  }
  return results;
};
