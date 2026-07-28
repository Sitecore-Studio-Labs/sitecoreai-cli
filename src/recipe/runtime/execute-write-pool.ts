import type { AuthoringApiClient, RemoteFieldValue, UpdateItemInput } from "../api/client";
import { renderRefValue } from "../api/ref-encoding";
import type { Operation, OperationIr } from "../ir/operations";
import type { PlannedAction, PlanSummary } from "./plan";
import type { ExecuteOptions } from "./execute-types";
import { errorMessage, trySkipUnavailableLanguage } from "./execute-languages";

/**
 * Write-through for the push-scoped caches (see
 * `ExecuteOptions.idSnapshotCache` / `versionStackCache`): merge an
 * update-write's fields into the cached snapshot, or bump a version
 * add's stack to the op's declared target. Called from the apply loop
 * at enqueue/dispatch time — BEFORE the wire call resolves — so plans
 * of later ops read their predecessors' writes. A write that
 * subsequently fails either aborts the push (fatal → rollback; the
 * poisoned cache is never read again) or skips on the
 * unregistered-language tolerance (later ops on that language fail and
 * skip identically, so the optimistic cache stays consistent).
 *
 * Snapshot merges are COPY-ON-WRITE: `buildAction` attaches the cached
 * object to each action as its rollback `snapshot`, so mutating it in
 * place would corrupt the pre-op state rollback restores from.
 */
export const recordPendingWrite = (
  mutation: PooledMutation,
  op: Operation,
  options: Pick<ExecuteOptions, "idSnapshotCache" | "versionStackCache">
): void => {
  if (mutation.kind === "addItemVersion") {
    if (!options.versionStackCache || op.op !== "AddItemVersion") return;
    const key = mutation.itemId.toLowerCase();
    const stack = options.versionStackCache.get(key) ?? new Map<string, number>();
    stack.set(mutation.language.toLowerCase(), op.version);
    options.versionStackCache.set(key, stack);
    return;
  }
  const input = mutation.input;
  const snapshot = options.idSnapshotCache?.get(input.itemId.toLowerCase());
  if (!snapshot) return;
  const merged = [...snapshot.fields];
  for (const f of input.fields) {
    const rendered: RemoteFieldValue = {
      fieldId: f.fieldId,
      ...(f.fieldName !== undefined && { name: f.fieldName }),
      value: renderRefValue(f.value),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.version !== undefined && { version: input.version }),
    };
    const at = merged.findIndex(
      (existing) =>
        existing.fieldId.toLowerCase() === f.fieldId.toLowerCase() &&
        existing.language === input.language &&
        existing.version === input.version
    );
    if (at >= 0) merged[at] = rendered;
    else merged.push(rendered);
  }
  options.idSnapshotCache?.set(input.itemId.toLowerCase(), { ...snapshot, fields: merged });
};

/** Mutations the flush pool may carry. */
export type PooledMutation =
  | { kind: "updateItem"; input: UpdateItemInput }
  | { kind: "addItemVersion"; itemId: string; language: string; addCount: number };

/** One planned pooled write (`updateItem` or `addItemVersion`) queued into the flush pool. */
export interface PooledWrite {
  index: number;
  op: Operation;
  action: PlannedAction & { mutation: PooledMutation };
}

export const isPooledMutation = (
  mutation: NonNullable<PlannedAction["mutation"]>
): mutation is PooledMutation =>
  mutation.kind === "updateItem" || mutation.kind === "addItemVersion";

/** (itemId, language) stack key — the pool's serialization unit. */
const stackKey = (itemId: string, language: string | undefined): string =>
  `${itemId.toLowerCase()}|${language ?? ""}`;

/**
 * Bounded-concurrency flush pool for `updateItem` and `addItemVersion`
 * mutations — the apply loop's throughput lever (see
 * `ExecuteOptions.applyConcurrency`).
 *
 * Invariants:
 *  - **Per-(item, language) serialization.** Tasks chain on the target
 *    (itemId, language) version stack, so writes to the same stack always
 *    apply in op order — while stacks of DIFFERENT languages on the same
 *    item overlap freely (Sitecore versions each language independently).
 *    This is what lets a component's 9 locale version-adds run
 *    concurrently instead of one at a time.
 *  - **Cell coalescing.** Consecutive queued-but-not-started `updateItem`
 *    entries for the same (itemId, language, version) cell merge into ONE
 *    call with their `fields` concatenated — semantically identical to N
 *    sequential single-field calls (`UpdateItemInput` carries
 *    language/version at the input level, so only same-cell entries may
 *    merge). An `addItemVersion` enqueue CLOSES its stack's pending cells
 *    so later field writes can never merge across the version boundary.
 *  - **Failure isolation.** A failed coalesced call is retried per-entry
 *    sequentially so the failing op is identified; each entry failure
 *    then follows the sequential apply-error semantics — language-skip
 *    tolerance first, otherwise the first failure is recorded as
 *    `fatal` for the main loop to turn into rollback + abort at the
 *    next drain point.
 *
 * Plan-time reads coordinate through `settle(itemId, language)`: the main
 * loop awaits just that stack's chain before planning an op that reads it,
 * instead of draining the whole pool (see `settleForPlan`).
 *
 * The pool never rejects: every task traps its own errors into `fatal`,
 * and `drain()` resolves once all in-flight work settles.
 */
export class WritePool {
  private readonly limit: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly chains = new Map<string, Promise<void>>();
  /** Last VERSION-ADD task per stack — the narrower settle target for plan reads that only care about version existence (see settleAdds). */
  private readonly addChains = new Map<string, Promise<void>>();
  private readonly pendingCells = new Map<string, PooledWrite[]>();
  private readonly tasks: Promise<void>[] = [];
  fatal?: { entry: PooledWrite; message: string };

  constructor(
    limit: number,
    private readonly deps: {
      client: AuthoringApiClient;
      summary: PlanSummary;
      applied: PlannedAction[];
      emit: ExecuteOptions["emit"];
      onError: ExecuteOptions["onError"];
    }
  ) {
    this.limit = Math.max(1, limit);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }

  /** Chain `run` onto a stack's task chain, bounded by the semaphore. */
  private chainTask(chainKey: string, run: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(chainKey) ?? Promise.resolve();
    const task = prev.then(async () => {
      if (this.fatal) return;
      await this.acquire();
      try {
        await run();
      } finally {
        this.release();
      }
    });
    this.chains.set(chainKey, task);
    this.tasks.push(task);
    return task;
  }

  enqueue(entry: PooledWrite): void {
    if (this.fatal) return; // push is already doomed — drain will abort
    if (entry.action.mutation.kind === "addItemVersion") {
      this.enqueueVersionAdd(entry, entry.action.mutation);
      return;
    }
    const input = entry.action.mutation.input;
    const chainKey = stackKey(input.itemId, input.language);
    const cellKey = `${chainKey}|${input.version ?? ""}`;
    const existing = this.pendingCells.get(cellKey);
    if (existing) {
      existing.push(entry);
      return;
    }
    const cell: PooledWrite[] = [entry];
    this.pendingCells.set(cellKey, cell);
    this.chainTask(chainKey, async () => {
      // Claim the cell at start — entries enqueued after this point open
      // a NEW cell chained behind this task (per-stack order preserved).
      this.pendingCells.delete(cellKey);
      await this.flushCell(cell);
    });
  }

  private enqueueVersionAdd(
    entry: PooledWrite,
    mutation: Extract<PooledMutation, { kind: "addItemVersion" }>
  ): void {
    const chainKey = stackKey(mutation.itemId, mutation.language);
    // Close this stack's pending cells: their tasks are already chained
    // BEFORE this add (correct order), but a LATER field write must never
    // merge into a pre-add cell — that would apply it before the version
    // it targets exists.
    for (const cellKey of this.pendingCells.keys()) {
      if (cellKey.startsWith(`${chainKey}|`)) this.pendingCells.delete(cellKey);
    }
    const task = this.chainTask(chainKey, async () => {
      try {
        // Sitecore assigns numbered versions sequentially — see
        // `dispatchMutation`'s addItemVersion branch, which this mirrors.
        for (let n = 0; n < mutation.addCount; n += 1) {
          await this.deps.client.addItemVersion({
            itemId: mutation.itemId,
            language: mutation.language,
          });
        }
        this.deps.applied.push(entry.action);
        this.deps.emit?.({ kind: "apply-success", action: entry.action });
      } catch (error) {
        this.recordFailure(entry, error);
      }
    });
    this.addChains.set(chainKey, task);
  }

  private async flushCell(entries: PooledWrite[]): Promise<void> {
    const inputs = entries.map(
      (e) => (e.action.mutation as Extract<PooledMutation, { kind: "updateItem" }>).input
    );
    const first = inputs[0];
    const merged: UpdateItemInput =
      inputs.length === 1
        ? first
        : {
            itemId: first.itemId,
            ...(first.language !== undefined && { language: first.language }),
            ...(first.version !== undefined && { version: first.version }),
            fields: inputs.flatMap((input) => input.fields),
          };
    try {
      await this.deps.client.updateItem(merged);
      for (const entry of entries) {
        this.deps.applied.push(entry.action);
        this.deps.emit?.({ kind: "apply-success", action: entry.action });
      }
      return;
    } catch (error) {
      if (entries.length === 1) {
        this.recordFailure(entries[0], error);
        return;
      }
    }
    // Coalesced call failed — isolate per entry, sequentially.
    for (let i = 0; i < entries.length; i += 1) {
      if (this.fatal) return;
      try {
        await this.deps.client.updateItem(inputs[i]);
        this.deps.applied.push(entries[i].action);
        this.deps.emit?.({ kind: "apply-success", action: entries[i].action });
      } catch (error) {
        this.recordFailure(entries[i], error);
      }
    }
  }

  private recordFailure(entry: PooledWrite, error: unknown): void {
    const message = errorMessage(error);
    if (
      trySkipUnavailableLanguage(entry.op, entry.action, message, this.deps.summary, this.deps.emit)
    ) {
      return;
    }
    entry.action.status = "error";
    entry.action.reason = message;
    this.deps.emit?.({ kind: "apply-error", action: entry.action, error: message });
    // Tolerant push (`onError: "continue"`): record + surface the error but
    // don't mark it fatal, so `drainPool` never aborts and the recipe keeps
    // flushing the rest of its writes. Count it into `summary.error` so the
    // per-recipe summary reflects the tolerated failure. Strict (default)
    // sets the first fatal, which triggers rollback + abort.
    if (this.deps.onError === "continue") {
      this.deps.summary.error += 1;
      return;
    }
    if (!this.fatal) this.fatal = { entry, message };
  }

  /**
   * Await ONLY the given (itemId, language) stack's in-flight writes —
   * the plan-read coordination primitive. Unlike `drain()`, other stacks
   * keep flowing, so a plan read for item A never stalls behind item B's
   * writes. Callers check `fatal` afterwards.
   */
  async settle(itemId: string, language: string | undefined): Promise<void> {
    const chain = this.chains.get(stackKey(itemId, language));
    if (chain) await chain;
  }

  /**
   * Await only the given stack's in-flight VERSION ADDS — the narrower
   * settle for plan reads that care about version existence but not
   * field values (`SetField` drift diffs, `AddItemVersion`
   * reconciliation). Plain field writes to the same stack keep flowing,
   * which is what preserves same-cell coalescing: a page's consecutive
   * SetFields would otherwise each wait for the previous one's POST.
   */
  async settleAdds(itemId: string, language: string | undefined): Promise<void> {
    const chain = this.addChains.get(stackKey(itemId, language));
    if (chain) await chain;
  }

  async drain(): Promise<void> {
    // enqueue() only runs from the (single-threaded) main loop, which is
    // awaiting us — the task list cannot grow while draining.
    await Promise.all(this.tasks);
    this.tasks.length = 0;
  }
}

/** Per-IR refKey → languages its `AddItemVersion` ops target — see `ExecuteOptions.versionStackCache`. */
export const indexAddVersionLanguages = (ir: OperationIr): Map<string, string[]> => {
  const byRef = new Map<string, string[]>();
  for (const candidate of ir.operations) {
    if (candidate.op !== "AddItemVersion") continue;
    const langs = byRef.get(candidate.itemRefKey) ?? [];
    if (!langs.includes(candidate.language)) langs.push(candidate.language);
    byRef.set(candidate.itemRefKey, langs);
  }
  return byRef;
};

/** Pool when `applyConcurrency` asks for overlap, undefined for the historical serial apply. */
export const maybeCreateWritePool = (
  options: ExecuteOptions,
  deps: ConstructorParameters<typeof WritePool>[1]
): WritePool | undefined => {
  const limit = options.applyConcurrency ?? 1;
  return limit > 1 ? new WritePool(limit, deps) : undefined;
};

/**
 * Await the pool stacks whose settled state this op's PLAN reads:
 *
 *  - `SetField` / `AddItemVersion` need their target stack's VERSION
 *    ADDS applied (a versioned diff or reconciliation against a stack
 *    whose add is still in flight plans against stale state) — but NOT
 *    its field writes, which touch different fields by construction;
 *    waiting on those would serialize the very writes the pool exists
 *    to overlap (`settleAdds`).
 *  - `SetBaseTemplates` / `SetStandardValues` / `AppendToMultiList`
 *    diff/merge against SHARED field VALUES — they await the full
 *    (item, undefined-language) stack chain (`settle`).
 *
 * RefKeys that aren't captured yet have no pooled writes (pooled inputs
 * are built FROM captured ids), so they settle nothing. Ops that don't
 * read pooled state (creates, media, prunes, site ops) settle nothing —
 * their DISPATCH still global-drains via `applySequential`.
 */
export const settleForPlan = async (
  pool: WritePool,
  op: Operation,
  capturedItemIds: ReadonlyMap<string, string>
): Promise<void> => {
  const settleOne = async (refKey: string, language: string | undefined, addsOnly: boolean) => {
    const itemId = capturedItemIds.get(refKey);
    if (!itemId) return;
    if (addsOnly) await pool.settleAdds(itemId, language);
    else await pool.settle(itemId, language);
  };
  if (op.op === "SetField" || op.op === "AddItemVersion") {
    await settleOne(op.itemRefKey, op.language, true);
  } else if (op.op === "SetBaseTemplates" || op.op === "AppendToMultiList") {
    await settleOne(op.itemRefKey, undefined, false);
  } else if (op.op === "SetStandardValues") {
    await settleOne(op.templateRefKey, undefined, false);
    await settleOne(op.standardValuesRefKey, undefined, false);
  }
};
