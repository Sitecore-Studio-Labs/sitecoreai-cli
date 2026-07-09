import { datasourceId, fieldId, templateId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type PushPolicy,
  type SetFieldOp,
} from "../ir/operations";
import {
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  SITECORE_TEMPLATE_PATHS,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import type { Layout } from "../schema/recipe";
import { encodeContentFieldValue } from "./content-item";
import { normalizeFieldValue } from "./page";
import { type CompileContext, joinPath, sharedField, versionedField } from "./shared";

/**
 * Scoped-datasource materialisation for the layout-holding items that host
 * their own content but are NOT the render-time context: partial designs and
 * page designs.
 *
 * A `kind: "scoped"` placement means "this rendering's content belongs to THIS
 * design and is authored inline." The design item hosts a real datasource item
 * at `<design>/Data/<slot>`, shared by every page that uses the design — the
 * right semantics for design chrome like a footer sign-off.
 *
 * The page compiler materialises the same `<page>/Data/<slot>` structure
 * (`compile/page.ts`) and references its slots with the page-relative
 * `ds="local:/Data/<slot>"` form. Partial designs reference their slots the
 * same way: XM Cloud Pages authors a partial design's own datasources with
 * `local:/Data/<slot>` (resolved for the partial's renderings against the
 * items materialised under the partial design), so the compiler mirrors that
 * form rather than an absolute GUID. Page designs still pass
 * `scopedDatasourceIdFor` for any own placements (an absolute GUID), since a
 * page design's `__Renderings` round-trips canonical byte-for-byte.
 */

export interface ScopedSlotInfo {
  /** Handle of the placed component — drives datasource-template fallback. */
  componentHandle: string;
  /** Field values for the materialised `<design>/Data/<slot>` item. */
  fields: Record<string, unknown>;
}

/** Collect the deduped `<slot, ScopedSlotInfo>` map for a design's layout. */
export const collectScopedSlots = (layout: Layout | undefined): Map<string, ScopedSlotInfo> => {
  const slots = new Map<string, ScopedSlotInfo>();
  if (!layout) return slots;
  for (const placements of Object.values(layout.placeholders)) {
    for (const placement of placements) {
      if (placement.datasourceRef?.kind === "scoped" && !slots.has(placement.datasourceRef.slot)) {
        slots.set(placement.datasourceRef.slot, {
          componentHandle: placement.componentHandle,
          fields: placement.datasourceRef.fields ?? {},
        });
      }
    }
  }
  return slots;
};

/**
 * Resolve the datasource template handle for a placed component, in the same
 * precedence the page compiler uses for its per-slot `templateOf`:
 *   1. `datasource.template`      — single dedicated template
 *   2. `datasource.templates[0]`  — compatible-datasources; the FIRST is the
 *      primary shape (such components ship NO component-template item of their
 *      own, so the handle fallback would emit a refKey nothing creates)
 *   3. the component handle itself — inline-`fields:` pattern, or a standalone
 *      compile with no `componentsByHandle`
 */
const datasourceTemplateHandleFor = (componentHandle: string, context: CompileContext): string => {
  const component = context.componentsByHandle?.get(componentHandle);
  return (
    component?.datasource?.template?.handle ??
    component?.datasource?.templates?.[0]?.handle ??
    componentHandle
  );
};

/**
 * Collect the deduped set of datasource-template handles for the design's
 * `Data` folder Insert Options — the union across EVERY placement (not just
 * scoped ones), by the same precedence as `collectPageDataInsertOptions`.
 */
export const collectDataInsertOptions = (
  layout: Layout | undefined,
  context: CompileContext
): readonly string[] => {
  if (!layout) return [];
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const placements of Object.values(layout.placeholders)) {
    for (const placement of placements) {
      const component = context.componentsByHandle?.get(placement.componentHandle);
      const candidateHandles: string[] = component?.datasource?.templates?.length
        ? component.datasource.templates.map((t) => t.handle)
        : component?.datasource?.template
          ? [component.datasource.template.handle]
          : [placement.componentHandle];
      for (const handle of candidateHandles) {
        if (seen.has(handle)) continue;
        seen.add(handle);
        handles.push(handle);
      }
    }
  }
  return handles;
};

export interface ScopedMaterialization {
  /** Data folder + Insert-Options + per-slot `CreateItem` ops, in order. */
  structureOps: Operation[];
  /** Field `SetField` ops for the materialised slot items (versioned). */
  fieldOps: SetFieldOp[];
  /** Resolver for `emitLayoutXml`'s `scopedDatasourceIdFor` (absolute GUID). */
  scopedDatasourceIdFor: (slot: string) => string;
}

/**
 * Build the ops that materialise a design's scoped datasource items under
 * `<design>/Data/<slot>`. Returns `structureOps` (creation) and `fieldOps`
 * (values) separately so the caller can land the layout SetField (which the
 * items' GUIDs resolve against) between them.
 */
export function materializeScopedDatasources(params: {
  hostItemRefKey: string;
  hostItemPath: string;
  scopedSlots: Map<string, ScopedSlotInfo>;
  insertOptionHandles: readonly string[];
  site: string;
  policy: PushPolicy;
  context: CompileContext;
  recipeHandle: string;
  /** Op-label prefix: `"partial-design"` | `"page-design"`. */
  labelPrefix: string;
}): ScopedMaterialization {
  const {
    hostItemRefKey,
    hostItemPath,
    scopedSlots,
    insertOptionHandles,
    site,
    policy,
    context,
    recipeHandle,
    labelPrefix,
  } = params;

  const scopedDatasourceIdFor = (slot: string): string => datasourceId(hostItemRefKey, slot);
  const structureOps: Operation[] = [];
  const fieldOps: SetFieldOp[] = [];
  if (scopedSlots.size === 0) {
    return { structureOps, fieldOps, scopedDatasourceIdFor };
  }

  const dataFolderRefKey = datasourceId(hostItemRefKey, "Data");
  const dataFolderPath = joinPath(hostItemPath, "Data");
  structureOps.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `${labelPrefix}-data-folder:${recipeHandle}`,
    id: dataFolderRefKey,
    path: dataFolderPath,
    parent: { kind: "ref-recipe", refKey: hostItemRefKey },
    // SXA's Page Data template — the same datasource-storage template the page
    // compiler uses — so SXA/Pages recognise the folder as local datasource
    // storage rather than a plain folder.
    templateOf: { kind: "ref-path", value: SITECORE_TEMPLATE_PATHS.SXA_PAGE_DATA },
    name: "Data",
    fields: [],
  } satisfies CreateItemOp);

  if (insertOptionHandles.length > 0) {
    structureOps.push({
      op: "SetField",
      policy: "CreateOnly",
      label: `${labelPrefix}-data-folder-insert-options:${recipeHandle}`,
      itemRefKey: dataFolderRefKey,
      fieldId: SYSTEM_FIELDS.INSERT_OPTIONS,
      value: {
        kind: "ref-recipe-list",
        refKeys: insertOptionHandles.map((handle) => templateId(site, handle)),
        tolerateMissing: true,
      },
    } satisfies SetFieldOp);
  }

  for (const [slot, info] of scopedSlots) {
    const datasourceTemplateHandle = datasourceTemplateHandleFor(info.componentHandle, context);
    const slotItemRefKey = datasourceId(hostItemRefKey, slot);
    structureOps.push({
      op: "CreateItem",
      policy,
      label: `${labelPrefix}-datasource:${recipeHandle}:${slot}`,
      id: slotItemRefKey,
      path: joinPath(dataFolderPath, slot),
      parent: { kind: "ref-recipe", refKey: dataFolderRefKey },
      templateOf: templateId(site, datasourceTemplateHandle),
      name: slot,
      fields: [
        sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: slot }),
      ],
    } satisfies CreateItemOp);

    for (const [fieldName, rawValue] of Object.entries(info.fields)) {
      const normalised = normalizeFieldValue(rawValue);
      if (normalised === null) continue;
      const value = encodeContentFieldValue(normalised, recipeHandle, site);
      fieldOps.push({
        op: "SetField",
        policy,
        label: `${labelPrefix}-scoped:${recipeHandle}:${slot}:${fieldName}`,
        itemRefKey: slotItemRefKey,
        fieldId: fieldId(site, datasourceTemplateHandle, fieldName),
        fieldName,
        language: DEFAULT_LANGUAGE,
        version: DEFAULT_VERSION,
        value,
      } satisfies SetFieldOp);
    }
  }

  return { structureOps, fieldOps, scopedDatasourceIdFor };
}
