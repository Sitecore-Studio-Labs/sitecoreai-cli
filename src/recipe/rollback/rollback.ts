import { createScaiError } from "@/shared/errors";
import type {
  AuthoringApiClient,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "../api/client";
import type { FieldValue } from "../ir/operations";
import type { PlannedAction, PrunedItemSnapshot } from "../runtime/plan";
import type { RollbackLogger } from "./rollback-log";

/**
 * Best-effort rollback for partial recipe pushes.
 *
 * When the executor's apply phase errors mid-IR, ops that already landed
 * are still on the tenant. The rollback module unwinds them in LIFO order
 * (reverse of the apply order, which mirrors topological order) using the
 * pre-mutation snapshot each op captured at plan time:
 *
 *   - applied `createItem` (snapshot was null) → `deleteItem(itemId)`
 *   - applied `updateItem` → `updateItem` with the prior value of each
 *     touched field, or empty string when the field was unset
 *
 * "Best-effort" means a rollback step that itself errors is logged and
 * counted, never cascaded — remaining rollbacks still run. The result
 * carries `{rolledBack, errors}` for the terminal `failed` event payload.
 */

/**
 * Restoration node for a pruned subtree. Trees are walked depth-first by
 * the rollback executor: `parent` becomes the freshly-assigned itemId
 * after each `createItem`, and that itemId is then used as the parent of
 * every child's recursive restore call.
 *
 * Field restoration:
 *  - `sharedFields` and `initialFields` are passed to `createItem`, so
 *    the new item materialises in `defaultLanguage` v1 with the shared
 *    fields + that (language, version)'s versioned values populated.
 *  - `extraVersions` carries every OTHER (language, version) the
 *    snapshot captured. The executor walks them in ascending order per
 *    language, calling `addItemVersion(itemId, language)` enough times
 *    to materialise each version slot, then `updateItem(itemId,
 *    language, version, fields)` to populate it.
 *
 * After restoration, the recreated item has the same shared fields, the
 * same per-(language, version) versioned field values, and the same
 * version count per language as the snapshot. Only the itemId differs
 * — Sitecore assigns a fresh GUID on `createItem` and the Authoring API
 * has no input for preserving the original.
 */
export interface PrunedSubtreeRestoreNode {
  /** Sitecore itemId of the parent under which to recreate this item. */
  parent: string;
  templateId: string;
  name: string;
  /**
   * Language passed to the inverse `createItem` call — typically the
   * first entry in the operator's `snapshotLanguages` config that the
   * snapshot found versions for. Determines which (language, version)
   * tuple `initialFields` populates.
   */
  defaultLanguage: string;
  /**
   * Shared fields (no language/version) + versioned fields for
   * (defaultLanguage, version 1). Written by `createItem`.
   */
  initialFields: FieldValue[];
  /**
   * Every other (language, version) the snapshot captured. The
   * executor materialises each via `addItemVersion` (called as many
   * times as needed to reach the requested version in that language)
   * followed by `updateItem(itemId, language, version, fields)`.
   *
   * Order: language order from whichever resolved into `candidateLanguages`
   * in `planPruneChildren` — operator's `snapshotLanguages` when set,
   * otherwise the tenant set returned by `client.getTenantLanguages`.
   * Within a language, versions ascending. (defaultLanguage, 1) is NOT
   * in this list — `createItem` already wrote it.
   */
  extraVersions: Array<{
    language: string;
    version: number;
    fields: FieldValue[];
  }>;
  /** Descendants to restore depth-first under this item's new itemId. */
  children: PrunedSubtreeRestoreNode[];
}

export type InverseMutation =
  | { kind: "deleteItem"; itemId: string }
  | { kind: "updateItem"; input: UpdateItemInput }
  | {
      /**
       * Inverse of an applied `pruneChildren` mutation: depth-first
       * recreation of each pruned subtree under its prior parent,
       * including the full (language, version) field grid for every
       * language the snapshot captured.
       *
       * The single remaining lossy bound: **itemIds change.** Sitecore
       * assigns itemIds server-side on `createItem` and the Authoring
       * API has no input for preserving the original GUID. Inbound
       * references (multi-list values, layout `<r id />` GUIDs, link
       * fields) that pointed at the old GUID stay broken after
       * restoration. GUID-preserving rollback would need the Content
       * Serialization API, which scai does not adopt.
       *
       * What IS preserved:
       *  - The full subtree shape (recursive snapshot at plan time).
       *  - Item names, templates, parent-child relationships.
       *  - Shared field values.
       *  - Per-(language, version) versioned field values for every
       *    language the operator listed in `--snapshot-languages`.
       *  - Per-language version counts.
       *
       * Per-item failures (parent missing, name collision with a sibling
       * already restored, addItemVersion/updateItem failure) are
       * aggregated into the rollback errors list; remaining nodes still
       * attempt restore. A subtree whose root fails to create skips its
       * children (no parent itemId to attach under) and logs the
       * cascade as a single failure on the root.
       */
      kind: "restoreItems";
      trees: ReadonlyArray<PrunedSubtreeRestoreNode>;
    };

export interface RollbackError {
  index: number;
  label: string;
  error: string;
}

export interface RollbackResult {
  rolledBack: number;
  errors: RollbackError[];
}

export type RollbackEvent =
  | { kind: "rollback-start"; action: PlannedAction }
  | { kind: "rollback-skip"; action: PlannedAction; reason: string }
  | { kind: "rollback-success"; action: PlannedAction }
  | { kind: "rollback-failed"; action: PlannedAction; error: string };

export interface RollbackOptions {
  emit?: (event: RollbackEvent) => void;
  /**
   * On-disk audit log. When provided, each compensating-op outcome
   * (success/skip/failure) is appended to the run's JSONL file so an
   * operator can audit what happened — including which items rollback
   * itself failed on. The caller is responsible for writing the run's
   * terminal summary line after `rollback()` returns.
   */
  log?: { logger: RollbackLogger; recipe: string };
}

const findPriorValue = (
  snapshot: RemoteItem | null | undefined,
  fieldId: string,
  fieldName: string | undefined,
  language?: string,
  version?: number
): string | null => {
  if (!snapshot) return null;
  // Match by name when the IR carries one — recipe-created fields don't
  // share GUIDs between the IR (uuidv5 refKey) and the tenant (server-
  // assigned). Else match by fieldId (system fields, real Sitecore GUIDs).
  const found = snapshot.fields.find((f) => {
    const idMatches = fieldName
      ? f.name === fieldName
      : f.fieldId.toLowerCase() === fieldId.toLowerCase();
    return (
      idMatches &&
      (language === undefined || f.language === language) &&
      (version === undefined || f.version === version)
    );
  });
  return found ? found.value : null;
};

/**
 * Produce the inverse mutation for an applied action. Returns `null` when
 * there's nothing to undo (a skip with no mutation).
 *
 * For an applied `createItem`, the inverse is `deleteItem(itemId)` where
 * `itemId` is the Sitecore-assigned ID — captured by the executor on
 * dispatch and looked up here via `capturedItemIds[action.operation.id]`.
 *
 * For an applied `updateItem`, each touched field reverts to its prior
 * snapshot value. If a field was unset prior, the inverse sets it to ""
 * (Sitecore's pragmatic clear). True "field-not-set" semantics would
 * require a deleteField mutation; not yet implemented.
 */
export const inverseOf = (
  action: PlannedAction,
  capturedItemIds: ReadonlyMap<string, string>
): InverseMutation | null => {
  if (!action.mutation) return null;

  if (action.mutation.kind === "createItem") {
    if (action.operation.op !== "CreateItem") {
      throw createScaiError("createItem mutation expected on a CreateItem operation.", "UNKNOWN");
    }
    const itemId = capturedItemIds.get(action.operation.id);
    if (!itemId) {
      // The create dispatched but we never captured its assigned itemId —
      // refuse to roll back rather than guess. Caller treats as best-effort
      // failure and continues.
      throw createScaiError(
        `Rollback: no captured itemId for createItem refKey ${action.operation.id}.`,
        "UNKNOWN"
      );
    }
    return { kind: "deleteItem", itemId };
  }

  if (action.mutation.kind === "createSite") {
    // Site rollback is intentionally warn-only. The Sites API's
    // `deleteSite` cascades through pages, settings, media, datasources,
    // presentation, dictionaries, components, variants, and page designs
    // — destructive enough that an automatic rollback during a
    // half-failed push could remove operator content. Operators delete
    // sites explicitly; the recipe pipeline doesn't.
    return null;
  }

  if (action.mutation.kind === "addItemVersion") {
    // Version-add rollback is warn-only. When the item itself was created
    // by this push, the `createItem` inverse (deleteItem) removes the whole
    // item — versions included — so an explicit version delete is
    // redundant. When the item pre-existed, a half-failed push can leave an
    // empty added version behind; that's benign (no field values written)
    // and recoverable by hand. A precise inverse would need a
    // `deleteItemVersion` mutation — deferred.
    return null;
  }

  if (action.mutation.kind === "mediaUpload") {
    // Media upload rollback is warn-only. A precise inverse would
    // `deleteItem` the freshly-uploaded media item using the captured
    // itemId — safe enough on a clean first-push abort, but the
    // upload's idempotent re-use of an existing path means a rollback
    // could delete an item the recipe didn't create (it merely
    // re-captured). Deferred until a per-op "did we create this?"
    // flag lands; until then a half-failed push leaves the media
    // item present (idempotent re-push converges).
    return null;
  }

  if (action.mutation.kind === "pruneChildren") {
    // Warn-mode prunes do nothing at apply time — there's nothing to
    // undo. Same for delete-mode prunes that the executor skipped
    // because the operator didn't pass --allow-prune (the executor
    // throws POLICY_DENIED before any deleteItem call).
    if (action.mutation.mode === "warn") return null;

    const pruned = action.prunedItems ?? [];
    if (pruned.length === 0) return null;

    // Build a recursive tree of restore nodes from the snapshot. Each
    // node splits its per-(language, version) snapshot into:
    //  - initialFields: shared fields + the FIRST (defaultLanguage, 1)
    //    entry's versioned fields, passed to the inverse createItem.
    //  - extraVersions: every OTHER (language, version) — the executor
    //    will addItemVersion + updateItem its way through them after
    //    createItem.
    //
    // See PrunedSubtreeRestoreNode + InverseMutation `restoreItems`
    // JSDoc for the remaining lossy bound (itemId regeneration).
    const toFieldValue = (f: RemoteFieldValue): FieldValue => ({
      fieldId: f.fieldId,
      ...(f.name !== undefined ? { fieldName: f.name } : {}),
      ...(f.language !== undefined ? { language: f.language } : {}),
      ...(f.version !== undefined ? { version: f.version } : {}),
      value: { kind: "string", value: f.value },
    });
    const toNode = (s: PrunedItemSnapshot, parentId: string): PrunedSubtreeRestoreNode => {
      // Pick the initial version: first (defaultLanguage, 1) the
      // snapshot recorded, falling back to the first entry overall.
      // `versions` is guaranteed non-empty by planPruneChildren's
      // fallback branch.
      const initial = s.versions[0];
      const initialFields: FieldValue[] = [
        ...s.sharedFields.map(toFieldValue),
        ...initial.fields.map(toFieldValue),
      ];
      const extraVersions = s.versions.slice(1).map((v) => ({
        language: v.language,
        version: v.version,
        fields: v.fields.map(toFieldValue),
      }));
      return {
        parent: parentId,
        templateId: s.templateId,
        name: s.name,
        defaultLanguage: initial.language,
        initialFields,
        extraVersions,
        // Children's `parent` is rewritten at execute time to the
        // freshly-assigned itemId of THIS node's createItem result.
        // The placeholder here ("") is overwritten in walkRestore below.
        children: s.children.map((c) => toNode(c, "")),
      };
    };
    const trees = pruned.map((p) => toNode(p, p.parentId));

    return { kind: "restoreItems", trees };
  }

  // updateItem: each touched field reverts to its prior snapshot value.
  const priorFields: FieldValue[] = action.mutation.input.fields.map((field) => {
    const prior = findPriorValue(
      action.snapshot,
      field.fieldId,
      field.fieldName,
      field.language,
      field.version
    );
    return {
      fieldId: field.fieldId,
      fieldName: field.fieldName,
      language: field.language,
      version: field.version,
      value: { kind: "string", value: prior ?? "" },
    };
  });

  return {
    kind: "updateItem",
    input: { itemId: action.mutation.input.itemId, fields: priorFields },
  };
};

/**
 * Unwind `applied` actions in LIFO order. Each step catches its own
 * errors so a rollback failure on op N doesn't abort rollback of op N-1.
 */
export const rollback = async (
  applied: PlannedAction[],
  client: AuthoringApiClient,
  capturedItemIds: ReadonlyMap<string, string>,
  options: RollbackOptions = {}
): Promise<RollbackResult> => {
  const result: RollbackResult = { rolledBack: 0, errors: [] };

  const log = options.log;
  const recordStep = async (
    action: PlannedAction,
    status: "success" | "failed" | "skip",
    extras: {
      inverse?: InverseMutation | null;
      reason?: string;
      error?: string;
      /**
       * Actual count of nodes the restoreItems executor SUCCESSFULLY
       * created. Distinct from the total node count in `inverse.trees`
       * (which is intent, not outcome) — operators auditing partial
       * restores need to know the outcome to gauge damage.
       */
      restoredActual?: number;
    }
  ): Promise<void> => {
    if (!log) return;
    await log.logger.recordStep(log.recipe, {
      index: action.index,
      label: action.operation.label,
      status,
      inverse: extras.inverse?.kind,
      itemId: extras.inverse?.kind === "deleteItem" ? extras.inverse.itemId : undefined,
      // restoredCount is OUTCOME — pass through what the executor
      // actually achieved, not the tree-node count from the intent.
      restoredCount: extras.restoredActual,
      reason: extras.reason,
      error: extras.error,
    });
  };

  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const action = applied[i];
    let inverse: InverseMutation | null;
    try {
      inverse = inverseOf(action, capturedItemIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({
        index: action.index,
        label: action.operation.label,
        error: message,
      });
      options.emit?.({ kind: "rollback-failed", action, error: message });
      await recordStep(action, "failed", { error: message });
      continue;
    }

    if (!inverse) {
      const reason = "no inverse needed (no forward mutation)";
      options.emit?.({ kind: "rollback-skip", action, reason });
      await recordStep(action, "skip", { reason });
      continue;
    }

    options.emit?.({ kind: "rollback-start", action });
    // Outer-scope tracker for `restoredItems` outcome: when the inverse
    // is `restoreItems`, this holds the actual count of nodes the
    // executor successfully restored. Threaded into recordStep on both
    // success and failure so audit logs reflect outcome, not intent.
    let restoreItemsActual: number | undefined;
    try {
      if (inverse.kind === "deleteItem") {
        await client.deleteItem({ itemId: inverse.itemId });
      } else if (inverse.kind === "updateItem") {
        await client.updateItem(inverse.input);
      } else {
        // restoreItems: depth-first recreation of each pruned subtree.
        // Per node:
        //   1. createItem(parent, template, name, defaultLanguage,
        //      initialFields) — materialises the item in defaultLanguage
        //      at v1 with shared + (defaultLanguage, 1) fields.
        //   2. For each extraVersions entry, ascending per language:
        //      addItemVersion(language) until the language's version
        //      count reaches the target, then updateItem(itemId,
        //      language, version, fields).
        //   3. Recurse into children under the new itemId.
        //
        // Best-effort: per-node failures (parent gone, name collision,
        // addItemVersion or updateItem failure) are aggregated;
        // remaining nodes still attempt restore. A subtree whose root
        // fails to create skips its children (no parent itemId to
        // attach under) and logs the cascade as a single failure on
        // the root.
        let restoredCount = 0;
        let cascadedSkipCount = 0;
        const perNodeErrors: string[] = [];
        const walkRestore = async (
          node: PrunedSubtreeRestoreNode,
          parentItemId: string
        ): Promise<void> => {
          let newItemId: string;
          try {
            const result = await client.createItem({
              parent: parentItemId,
              templateId: node.templateId,
              name: node.name,
              language: node.defaultLanguage,
              fields: node.initialFields,
            });
            newItemId = result.itemId;
            restoredCount += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            perNodeErrors.push(`${node.name}: ${message}`);
            // Cascade: count this node's descendants as skipped so the
            // operator sees the full blast radius in the error message.
            const countDescendants = (n: PrunedSubtreeRestoreNode): number =>
              n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
            cascadedSkipCount += countDescendants(node);
            return;
          }
          // Materialise the (language, version) grid via addItemVersion
          // chains + updateItem per entry. Track current version count
          // per language so we know how many addItemVersion calls to
          // make to reach each target.
          //
          // If any (lang, ver) entry fails, ABORT the subtree —
          // skipping children — and decrement `restoredCount` for THIS
          // node so the audit reflects "the create landed but the node
          // is half-baked." Continuing into children with a half-
          // restored parent would leave grandchildren attached to a
          // node whose version stack is wrong, masking the partial
          // failure under a "looks restored" structure.
          const versionCount = new Map<string, number>([[node.defaultLanguage, 1]]);
          let nodeFullyRestored = true;
          for (const entry of node.extraVersions) {
            try {
              const have = versionCount.get(entry.language) ?? 0;
              for (let v = have; v < entry.version; v += 1) {
                await client.addItemVersion({ itemId: newItemId, language: entry.language });
              }
              versionCount.set(entry.language, entry.version);
              await client.updateItem({
                itemId: newItemId,
                language: entry.language,
                version: entry.version,
                fields: entry.fields,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              perNodeErrors.push(`${node.name} (${entry.language} v${entry.version}): ${message}`);
              nodeFullyRestored = false;
              break;
            }
          }
          if (!nodeFullyRestored) {
            // Subtree abort: this node is half-baked, children are
            // unsafe to attach. Count this node as a partial-restore
            // failure (subtract from restoredCount) and cascade-skip
            // its descendants so the error message shows the full
            // blast radius.
            restoredCount -= 1;
            const countDescendants = (n: PrunedSubtreeRestoreNode): number =>
              n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
            cascadedSkipCount += countDescendants(node);
            return;
          }
          for (const child of node.children) {
            await walkRestore(child, newItemId);
          }
        };
        for (const tree of inverse.trees) {
          await walkRestore(tree, tree.parent);
        }
        // Stash the outcome count for the outer recordStep call —
        // success path uses it directly, failure path includes it
        // through the throw below.
        restoreItemsActual = restoredCount;
        const totalNodes = (() => {
          const count = (n: PrunedSubtreeRestoreNode): number =>
            1 + n.children.reduce((s, c) => s + count(c), 0);
          return inverse.trees.reduce((s, t) => s + count(t), 0);
        })();
        if (perNodeErrors.length > 0) {
          const skipped = cascadedSkipCount > 0 ? ` (+${cascadedSkipCount} cascaded skips)` : "";
          throw createScaiError(
            `Restored ${restoredCount} of ${totalNodes} pruned items${skipped}; failures: ${perNodeErrors.join("; ")}`,
            "UNKNOWN"
          );
        }
      }
      result.rolledBack += 1;
      options.emit?.({ kind: "rollback-success", action });
      await recordStep(action, "success", { inverse, restoredActual: restoreItemsActual });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({
        index: action.index,
        label: action.operation.label,
        error: message,
      });
      options.emit?.({ kind: "rollback-failed", action, error: message });
      await recordStep(action, "failed", {
        inverse,
        error: message,
        restoredActual: restoreItemsActual,
      });
      // best-effort: continue with remaining rollbacks
    }
  }

  return result;
};
