import { createScaiError } from "@/shared/errors";
import type { AuthoringApiClient, RemoteItem, RemoteFieldValue } from "../api/client";
import { renderRefValue } from "../api/ref-encoding";
import type { SitesApiClient } from "../api/sites-client";
import type { FieldValue } from "../ir/operations";
import type { PlannedAction } from "./plan";
import type { ExecutionEvent } from "./execute-types";
import { appendSiteLanguages, ensureEnvironmentLanguages } from "./execute-languages";

/**
 * Wait for an async Sites API job (createSite, deleteSite, etc.) to
 * reach a terminal state. The Sites API's `getJobStatus` returns
 * a Job whose `state` field carries the lifecycle ("Initial",
 * "Running", "Done", "Failed"). Poll with linear backoff until
 * terminal or until we exceed a generous wall-clock budget.
 *
 * Site creation is typically a few seconds on warm tenants, but cold
 * tenants and content-tree-heavy SiteTemplates can take significantly
 * longer. The 90s budget covers worst-case sandbox cold-starts; in
 * production we'd surface a slow-job event so operators see progress.
 */
// 5 minutes — cold tenants (and tenants with heavy SiteTemplate Module
// composition) routinely run 1-2 minutes; verified empirically against
// TestDemo 2026-06-06 during sub-milestone E (a `createSite` job
// resolving cleanly in ~110s). The shorter 90s ceiling was timing out
// the executor on jobs the tenant was still completing.
const SITES_JOB_POLL_BUDGET_MS = 5 * 60_000;
const SITES_JOB_POLL_INTERVAL_MS = 1_000;

const awaitSitesJob = async (
  sitesClient: SitesApiClient,
  jobHandle: string,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
  const start = Date.now();
  const deadline = start + SITES_JOB_POLL_BUDGET_MS;
  // The Sites API garbage-collects completed jobs aggressively — the
  // returned `jobHandle` from `createSite`/`deleteSite` may have
  // already lapsed by the time our first poll runs (verified
  // 2026-06-06 against TestDemo during sub-milestone E). A
  // `"X job was not found"` response on a never-observed job is
  // therefore treated the same as a `"Done"` poll: the caller's
  // subsequent `listSites` confirms the materialised site, and we
  // never saw a `Failed`/`Errored` state in between.
  while (Date.now() < deadline) {
    let job: Awaited<ReturnType<SitesApiClient["getJobStatus"]>>;
    try {
      job = await sitesClient.getJobStatus(jobHandle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/job was not found/i.test(message)) {
        emit?.({
          kind: "site-job-poll",
          jobHandle,
          phase: "Done (gc'd)",
          elapsedMs: Date.now() - start,
        });
        return;
      }
      throw error;
    }
    // Sites API deployments return either `state` (runtime) or `status`
    // (OpenAPI-spec) — accept either. See `Job` type in src/sites/api/jobs.ts.
    const phase = job.state ?? job.status ?? "";
    emit?.({ kind: "site-job-poll", jobHandle, phase, elapsedMs: Date.now() - start });
    if (phase === "Done" || phase === "Completed" || phase === "Succeeded") {
      return;
    }
    if (phase === "Failed" || phase === "Errored") {
      throw createScaiError(
        `Sites API job ${jobHandle} reported terminal state '${phase}'.`,
        "SITES_API_FAILED"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SITES_JOB_POLL_INTERVAL_MS));
  }
  throw createScaiError(
    `Sites API job ${jobHandle} did not finish within ${SITES_JOB_POLL_BUDGET_MS}ms.`,
    "SITES_API_FAILED"
  );
};

/**
 * Build a `RemoteItem` snapshot from a just-applied `createItem` so
 * subsequent reads of the same path within the push hit the cache
 * instead of querying Sitecore.
 *
 * Sitecore's Authoring API has a known read-after-write lag for
 * path-keyed lookups: `createItem` returns a 200 + assigned itemId
 * synchronously, but `getItem({ path })` for the new path can return
 * null for a few seconds while the path index propagates. Within a
 * single push, two recipes sharing a CreateOnly folder path (e.g.
 * `<enumerationsRoot>/Layout`, `<componentsRoot>/<sectionName>`) both
 * plan-then-apply against that path; without this synthetic snapshot,
 * the second recipe's planner reads stale-null, plans another create,
 * and Sitecore rejects with "name already defined on this level".
 *
 * The synthetic carries the input fields the executor just wrote, so
 * `computeFieldDrift` against it returns no drift — both CreateOnly
 * (skip) and CreateAndUpdate (also skip — same fields) yield correct
 * idempotent behavior. Real-tenant snapshots replace the synthetic on
 * the NEXT push (when the prefetch overrides it via `getItemsByPaths`).
 */
interface SynthesizeCreateSnapshotInput {
  itemId: string;
  parentItemId: string;
  templateId: string;
  name: string;
  path: string;
  fields: readonly FieldValue[];
}

const synthesizeCreateSnapshot = ({
  itemId,
  parentItemId,
  templateId,
  name,
  path,
  fields,
}: SynthesizeCreateSnapshotInput): RemoteItem => {
  const remoteFields: RemoteFieldValue[] = fields.map((f) => ({
    fieldId: f.fieldId,
    ...(f.fieldName !== undefined && { name: f.fieldName }),
    value: renderRefValue(f.value),
    ...(f.language !== undefined && { language: f.language }),
    ...(f.version !== undefined && { version: f.version }),
  }));
  return { itemId, parentId: parentItemId, templateId, name, path, fields: remoteFields };
};

export interface DispatchMutationOptions {
  client: AuthoringApiClient;
  sitesClient: SitesApiClient | undefined;
  action: PlannedAction;
  capturedItemIds: Map<string, string>;
  pathItemIdCache: Map<string, string> | undefined;
  pathSnapshotCache: Map<string, RemoteItem | null> | undefined;
  idSnapshotCache: Map<string, RemoteItem> | undefined;
  /** Records CreateItem refKeys whose apply adopted an existing item —
   *  see `ExecutionResult.adoptedItemRefKeys`. */
  adoptedItemRefKeys: Set<string> | undefined;
  allowPrune: boolean;
  emit?: (event: ExecutionEvent) => void;
}

/**
 * Dispatch a `createItem` mutation and record the new item everywhere
 * later ops resolve it from: the captured refKey map, both path caches
 * (a synthetic snapshot dodges Sitecore's path-index propagation lag),
 * and the itemId-keyed snapshot cache — the ops that FOLLOW a create
 * (SetField/AddItemVersion/SetBaseTemplates on the new item) look up by
 * captured itemId, not path, and this seed is what saves their per-op
 * getItem round trips.
 */
const dispatchCreateItem = async (
  client: AuthoringApiClient,
  action: PlannedAction,
  mutation: Extract<NonNullable<PlannedAction["mutation"]>, { kind: "createItem" }>,
  {
    capturedItemIds,
    pathItemIdCache,
    pathSnapshotCache,
    idSnapshotCache,
    adoptedItemRefKeys,
  }: Pick<
    DispatchMutationOptions,
    | "capturedItemIds"
    | "pathItemIdCache"
    | "pathSnapshotCache"
    | "idSnapshotCache"
    | "adoptedItemRefKeys"
  >
): Promise<void> => {
  const result = await client.createItem(mutation.input);
  if (action.operation.op !== "CreateItem") return;
  capturedItemIds.set(action.operation.id, result.itemId);
  // Adopt-as-is returns the existing item WITHOUT writing the create's
  // fields — record it so the baseline writer skips those field values.
  if (result.adopted) adoptedItemRefKeys?.add(action.operation.id);
  pathItemIdCache?.set(action.operation.path, result.itemId);
  const synthetic = synthesizeCreateSnapshot({
    itemId: result.itemId,
    parentItemId: mutation.input.parent,
    templateId: mutation.input.templateId,
    name: mutation.input.name,
    path: action.operation.path,
    fields: mutation.input.fields,
  });
  pathSnapshotCache?.set(action.operation.path, synthetic);
  idSnapshotCache?.set(result.itemId.toLowerCase(), synthetic);
};

export const dispatchMutation = async ({
  client,
  sitesClient,
  action,
  capturedItemIds,
  pathItemIdCache,
  pathSnapshotCache,
  idSnapshotCache,
  adoptedItemRefKeys,
  allowPrune,
  emit,
}: DispatchMutationOptions): Promise<void> => {
  if (!action.mutation) return;
  if (action.mutation.kind === "createItem") {
    await dispatchCreateItem(client, action, action.mutation, {
      capturedItemIds,
      pathItemIdCache,
      pathSnapshotCache,
      idSnapshotCache,
      adoptedItemRefKeys,
    });
    return;
  }
  if (action.mutation.kind === "updateItem") {
    await client.updateItem(action.mutation.input);
    return;
  }
  if (action.mutation.kind === "addItemVersion") {
    // Sitecore assigns numbered versions sequentially, so adding `addCount`
    // versions one at a time lands the item's version count at the op's
    // declared target. `addCount` is normally 1 (the compiler emits one op
    // per extra version); a larger value reconciles a gap.
    const { itemId, language, addCount } = action.mutation;
    for (let n = 0; n < addCount; n += 1) {
      await client.addItemVersion({ itemId, language });
    }
    return;
  }
  if (action.mutation.kind === "mediaUpload") {
    // Idempotency: try to read the resulting absolute path BEFORE
    // uploading; if a media item already exists at the same path, skip
    // the upload and just capture its itemId. This makes a re-push
    // a no-op once the media item exists, matching the rest of the IR
    // ops' idempotency model.
    const absolutePath = `/sitecore/media library/${action.mutation.itemPath}`;
    const existing = await client.getItem({ path: absolutePath });
    if (existing) {
      capturedItemIds.set(action.mutation.mediaRefKey, existing.itemId);
      return;
    }
    const result = await client.uploadMedia({
      itemPath: action.mutation.itemPath,
      bytes: action.mutation.bytes,
      mimeType: action.mutation.mimeType,
      ...(action.mutation.fileName !== undefined && { fileName: action.mutation.fileName }),
      ...(action.mutation.altText !== undefined && { alt: action.mutation.altText }),
      overwriteExisting: true,
    });
    capturedItemIds.set(action.mutation.mediaRefKey, result.itemId);
    return;
  }
  if (action.mutation.kind === "ensureLanguages") {
    // Existing-site language provisioning — same idempotent ensure the
    // createSite path runs, minus the site creation.
    if (!sitesClient) {
      throw createScaiError(
        "ensureLanguages mutation requires a SitesApiClient — none threaded into the executor.",
        "UNKNOWN"
      );
    }
    const envPresent = await ensureEnvironmentLanguages(sitesClient, action.mutation.languages);
    await appendSiteLanguages(sitesClient, action.mutation.site, envPresent);
    return;
  }
  if (action.mutation.kind === "pruneChildren") {
    // mode "warn": the planner surfaced the prune list (action.prunedItems)
    // for the operator to review — but apply intentionally does nothing.
    // Authors flip to mode "delete" once they're confident the list is
    // what they intend.
    if (action.mutation.mode === "warn") return;
    // mode "delete" + no operator opt-in: throw rather than silently
    // skip. A silent no-op would mask the recipe author's stated intent
    // and let operators discover too late that their --apply runs
    // weren't actually pruning anything.
    if (!allowPrune) {
      throw createScaiError(
        `PruneChildren op '${action.operation.label}' has mode='delete' but the push was not invoked with --allow-prune. Re-run with --allow-prune after reviewing the prune list in --what-if.`,
        "POLICY_DENIED"
      );
    }
    for (const itemId of action.mutation.itemIds) {
      await client.deleteItem({ itemId });
    }
    // Invalidate cached snapshots for deleted items so any subsequent
    // recipe in the same push (unlikely — prunes are sorted last — but
    // possible if hand-authored ordering puts something after) sees the
    // tenant state correctly.
    if (action.prunedItems) {
      for (const pruned of action.prunedItems) {
        pathSnapshotCache?.delete(pruned.path);
        pathItemIdCache?.delete(pruned.path);
        idSnapshotCache?.delete(pruned.itemId.toLowerCase());
      }
    }
    return;
  }
  // createSite: dispatch through Sites API, await the async job, then
  // look up the materialised site by name to capture its itemId so
  // subsequent SetField overrides (dictionary, taxonomy) targeting
  // items under the site can resolve via late-path seeding.
  if (!sitesClient) {
    throw createScaiError(
      "createSite mutation requires a SitesApiClient — none threaded into the executor.",
      "UNKNOWN"
    );
  }
  const { input, siteRefKey, languages } = action.mutation;
  // createSite fails on a language the environment doesn't have yet — add
  // the site's primary + additional languages first (idempotent).
  const envPresent = await ensureEnvironmentLanguages(sitesClient, languages);
  // Declare the full language list on the SITE at creation, not just the
  // primary — otherwise Pages never offers the additional locales on the
  // site even though the environment has them. Gated to codes the
  // environment actually registered (bare base admission codes the
  // catalog gate skipped must not ride into the site definition).
  const siteLanguages = languages.filter((code) => envPresent.has(code.toLowerCase()));
  const jobResponse = await sitesClient.createSite({
    ...input,
    ...(siteLanguages.length > 0 && { languages: siteLanguages }),
  });
  const jobHandle = jobResponse.handle ?? jobResponse.jobHandle;
  if (!jobHandle) {
    throw createScaiError(
      `createSite for '${input.siteName}' returned a JobResponse with no handle: ${JSON.stringify(jobResponse)}`,
      "SITES_API_FAILED"
    );
  }
  await awaitSitesJob(sitesClient, jobHandle, emit);
  // Capture the new site's itemId by reading the SXA content-tree
  // item directly via Authoring GraphQL. The Sites API's `listSites`
  // index is eventually-consistent — verified 2026-06-06 against
  // TestDemo, the index trailed the actual site materialisation by
  // minutes despite the SXA scaffolding job reporting "Done (gc'd)".
  // Authoring GraphQL reads the same master DB the scaffolding writer
  // commits to, so the content-tree item surfaces as soon as SXA
  // writes it. SXA convention puts the site at
  // `/sitecore/content/<collectionName>/<siteName>`; when the caller
  // passed `collectionId` instead, look up the collection item by ID
  // to read its content-tree path, then append the site name.
  const siteContentPath = await resolveSiteContentPath(client, input);
  const SITE_PATH_RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 30_000];
  let createdItemId: string | undefined;
  for (const delay of SITE_PATH_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const siteItem = await client.getItem({ path: siteContentPath });
    if (siteItem?.itemId) {
      createdItemId = siteItem.itemId;
      break;
    }
  }
  if (createdItemId) {
    capturedItemIds.set(siteRefKey, createdItemId);
  } else {
    throw createScaiError(
      `createSite for '${input.siteName}' completed but the site item is not present at '${siteContentPath}' after retries — cannot capture itemId.`,
      "SITES_API_FAILED"
    );
  }
};

/**
 * Build the SXA content-tree path for a just-created site. SXA places
 * sites at `/sitecore/content/<collectionName>/<siteName>`. When the
 * caller passed `collectionId` instead of `collectionName`, fetch the
 * collection item by ID to read its content-tree path, then append the
 * site name. Throws when neither is set — the Sites API would have
 * already rejected the createSite call upstream in that case.
 */
const resolveSiteContentPath = async (
  client: AuthoringApiClient,
  input: { siteName: string; collectionName?: string | null; collectionId?: string | null }
): Promise<string> => {
  if (input.collectionName) {
    return `/sitecore/content/${input.collectionName}/${input.siteName}`;
  }
  if (input.collectionId) {
    const collection = await client.getItem({ itemId: input.collectionId });
    if (!collection?.path) {
      throw createScaiError(
        `Cannot resolve content-tree path for site '${input.siteName}' — collection '${input.collectionId}' not found.`,
        "SITES_API_FAILED"
      );
    }
    return `${collection.path.replace(/\/+$/, "")}/${input.siteName}`;
  }
  throw createScaiError(
    `Cannot resolve content-tree path for site '${input.siteName}' — neither collectionName nor collectionId set.`,
    "SITES_API_FAILED"
  );
};
