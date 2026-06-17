/**
 * Reverse-projection — live Sitecore items → clean `Recipe` objects.
 *
 * This is the inverse of `src/recipe/compile/*`: where the compilers turn
 * recipes into the Sitecore items a push would create, `readCurrent` walks
 * the items a compiler *would have* produced and reconstructs the recipe.
 * It is the `readCurrent` half of the `recipe` recipe kind (see
 * `recipe-kind.ts` and docs/recipe-sync-architecture.md).
 *
 * ## Structure
 *
 * This file is the thin orchestration entry. The reverse-projection logic
 * lives in `read-current/`:
 *   - `helpers.ts` — GUID/field accessors, handle recovery, sort ordering,
 *     the Sitecore field-type ⇄ shape inverse maps, single-field
 *     projection, the per-template field-shape walker, the GUID→handle
 *     marker index, and layout-XML helpers.
 *   - `decode.ts` — the wire-format decoders (date, image/link XML,
 *     templates-mapping, and the `FieldShape`-dispatched value decoder).
 *   - `content-helpers.ts` — per-(language, version) field-decoding helpers
 *     shared by the page + content-item families.
 *   - `project-templates.ts` — component/content/page templates,
 *     component sections, enumerations, and their tree walkers.
 *   - `project-pages.ts` — the layout-bearing kinds (partial-design,
 *     page-design, page, placeholder) and their walkers.
 *   - `project-content.ts` — content items (kind 10) and their walker.
 *
 * For backwards-compatibility the historic internal symbols are re-exported
 * from here (see the re-export block at the bottom).
 *
 * ## Scope
 *
 * Ten recipe kinds reverse-project here — those whose item layout is
 * stable and recoverable from the content tree alone:
 *
 *   1.  `component-section`  — a Template Folder directly under componentsRoot
 *   2.  `component-template` — a Template with a matching rendering item
 *   3.  `content-template`   — a Template under contentModelsRoot, no rendering
 *   4.  `page-template`      — a Template carrying the SXA page base set
 *   5.  `enumeration`        — an Enumeration container under enumerationsRoot
 *   6.  `partial-design`     — an SXA Partial Design item under partialDesignsRoot
 *   7.  `page-design`        — an SXA Page Design item under pageDesignsRoot
 *   8.  `page`               — a page item under pagesRoot
 *   9.  `placeholder`        — a Placeholder Settings item under
 *                              placeholderSettingsRoot
 *   10. `content-item`       — a concrete item under contentItemsRoot whose
 *                              template resolves to a known content/component
 *                              template
 *
 * Kinds 6–9 are the layout-bearing (and layout-adjacent) kinds: their
 * fidelity hinges on parsing Sitecore layout XML back into the recipe
 * `Layout` structure — `src/recipe/layout/parse.ts`, the inverse of
 * `layout/emit.ts`. GUIDs inside the layout XML reference renderings and
 * datasources; `readCurrent` builds a GUID→handle index off the
 * `Scai Handle` marker (see `buildGuidHandleIndex`) and resolves them.
 *
 * Kind 10 is the content-bearing kind: per-(language, version) field
 * decoding via a template-field-shape map. Multi-language fan-out uses
 * `getTenantLanguages` + `getItemPerLanguageBatch` so an L-language read
 * is one round trip, not L. Per-(language, version) historic capture
 * follows via `getItemAtVersionsBatch` — same one-round-trip shape.
 *
 * Items under the configured roots that match none of these patterns are
 * silently skipped — not an error. The remaining kinds (site, workflow,
 * webhook-authorization, …) live in trees this walk doesn't visit;
 * `readCurrent` just doesn't produce them.
 *
 * ## Fidelity — this projection is LOSSY by design
 *
 * Recipes carry high-level *intent* the item tree doesn't preserve. The
 * contract is a documented best-effort: reconstruct what the items
 * faithfully yield, and where a recipe field genuinely can't be recovered,
 * **omit it or use the schema default — never fabricate a value**. A
 * `readCurrent` → compile → `plan` round-trip on an unchanged environment
 * should be close to all-`noop`; perfect is the goal, best-effort is the
 * accepted v1 bar. See the per-kind JSDoc in `read-current/` for exactly
 * what is faithful vs. approximated vs. omitted.
 *
 * Layout-XML reverse parsing is itself lossy at the GUID-resolution step:
 * a layout `<r>` element that references a GUID with no `Scai Handle`
 * marker is genuinely unrecoverable — the placement is dropped rather than
 * pointed at a fabricated handle. See `placementFromParsed`.
 *
 * ## v1 limitation
 *
 * `ref.id` is ignored — `readCurrent` pulls every reverse-projectable
 * subtree under the configured roots. Scoping the pull to a single item by
 * name is a future refinement; the orchestrator (`recipe-kind.ts`) passes
 * the whole-set `KindRef` today.
 */

import type { AuthoringApiClient } from "../api/client";
import type { Recipe } from "../schema/recipe";
import {
  type GuidHandleIndex,
  indexMarkersUnder,
  type TemplateFieldShapes,
} from "./read-current/helpers";
import {
  collectRenderingComponentNames,
  walkEnumerationsTree,
  walkTemplatesTree,
} from "./read-current/project-templates";
import {
  walkPageDesignsTree,
  walkPagesTree,
  walkPartialDesignsTree,
  walkPlaceholderSettingsTree,
} from "./read-current/project-pages";
import { walkContentItemsTree } from "./read-current/project-content";

/**
 * The compile-time content-tree roots `readCurrent` walks. Mirrors the
 * subset of `CompileContext` that the in-scope kinds actually live under.
 * `recipe-kind.ts` builds this off the resolved env profile — the same
 * fields `plan` reads.
 */
export interface ReadCurrentRoots {
  /** Legacy flat templates root. Content/component templates fall back here. */
  templatesRoot: string;
  /** Renderings root — used to detect which templates have a rendering. */
  renderingsRoot: string;
  /** Per-site Components bucket. Component templates + sections live here. */
  componentsRoot?: string;
  /** Per-site Content Models bucket. Content templates live here. */
  contentModelsRoot?: string;
  /** Page-templates root. Templates carrying the SXA page base set live here. */
  pageTemplatesRoot?: string;
  /** Enumerations root. Enumeration containers + value items live here. */
  enumerationsRoot?: string;
  /** Partial Designs root. SXA Partial Design items live here. */
  partialDesignsRoot?: string;
  /** Page Designs root. SXA Page Design items live directly under it. */
  pageDesignsRoot?: string;
  /** Pages root. Concrete page items live here (often the site Home node). */
  pagesRoot?: string;
  /** Placeholder Settings root. Placeholder Settings items live under it. */
  placeholderSettingsRoot?: string;
  /**
   * Content Items root. Concrete content-item items (the targets of `kind:
   * "shared"` datasource placements — site-logo, primary-nav, etc.) live
   * directly under it.
   */
  contentItemsRoot?: string;
}

/**
 * Build the GUID→handle index `readCurrent` resolves cross-item GUID
 * references against. Indexes:
 *
 *  - the renderings tree — so layout `<r id>` GUIDs and placeholder
 *    `Allowed Controls` GUIDs resolve to `componentHandle`s;
 *  - the templates trees (`componentsRoot` / `contentModelsRoot` /
 *    `pageTemplatesRoot` / the `templatesRoot` fallback) — so a page
 *    item's `templateId` and the Page Designs root's `TemplatesMapping`
 *    template GUIDs resolve to page-template handles;
 *  - the Partial Designs tree — so a page design's `PartialDesigns`
 *    GUID list resolves to partial-design handles;
 *  - the pages tree — so layout `<r ds>` GUIDs that point at page-local
 *    datasource items resolve.
 *
 * `read-current.ts` does not reverse-project content-item *items*
 * themselves — but it still needs their markers to resolve the GUIDs
 * layout XML points at, so the pages tree (which holds `<page>/Data/<slot>`
 * datasource items) is indexed too.
 *
 * Walking the same root twice is harmless — `indexMarkersUnder` is a pure
 * `Map.set`, and a duplicate path simply re-sets identical entries.
 */
const buildGuidHandleIndex = async (
  roots: ReadCurrentRoots,
  client: AuthoringApiClient
): Promise<GuidHandleIndex> => {
  const index: GuidHandleIndex = new Map();
  await indexMarkersUnder(roots.renderingsRoot, client, index);
  await indexMarkersUnder(roots.componentsRoot, client, index);
  await indexMarkersUnder(roots.contentModelsRoot, client, index);
  await indexMarkersUnder(roots.pageTemplatesRoot, client, index);
  // Flat templatesRoot fallback — only when no bucket root covers it (the
  // same dedup rule the templates walk uses).
  if (!roots.componentsRoot && !roots.contentModelsRoot) {
    await indexMarkersUnder(roots.templatesRoot, client, index);
  }
  await indexMarkersUnder(roots.partialDesignsRoot, client, index);
  await indexMarkersUnder(roots.pagesRoot, client, index);
  // Content items reference each other (single-element `refs[]` on a
  // Droplink, Treelist Source pickers, link-internal targets) by GUID;
  // index the content-items tree so the cross-CI references resolve.
  await indexMarkersUnder(roots.contentItemsRoot, client, index);
  return index;
};

/**
 * Reverse-project every in-scope subtree under the configured roots into a
 * `Recipe[]` — all ten reverse-projectable kinds (see the module JSDoc).
 *
 * Order of work: the templates trees and enumerations first, then the
 * layout-bearing kinds. The layout-bearing walkers share a GUID→handle
 * marker index (`buildGuidHandleIndex`) built once up front — skipped
 * entirely when no layout-bearing root is configured, so an environment
 * without partial/page designs pays nothing for the index walk.
 *
 * Returns `null` only when the environment has *no* roots configured at all
 * — the signal `recipe-kind.ts` uses to report "this environment has no
 * recipe-projectable surface." Otherwise always returns the array, which may
 * legitimately be empty (roots configured but empty trees).
 *
 * @param roots  Content-tree roots resolved off the env profile.
 * @param client Authoring API read client (`getItem` / `getChildren`).
 */
export const readCurrentRecipes = async (
  roots: ReadCurrentRoots,
  client: AuthoringApiClient
): Promise<Recipe[] | null> => {
  const isSet = (r: string | undefined): r is string => typeof r === "string" && r.length > 0;
  const anyRootSet = [
    roots.componentsRoot,
    roots.contentModelsRoot,
    roots.pageTemplatesRoot,
    roots.templatesRoot,
    roots.enumerationsRoot,
    roots.partialDesignsRoot,
    roots.pageDesignsRoot,
    roots.pagesRoot,
    roots.placeholderSettingsRoot,
    roots.contentItemsRoot,
  ].some(isSet);
  if (!anyRootSet) {
    // No roots at all — the environment has no recipe-projectable surface.
    return null;
  }

  const recipes: Recipe[] = [];

  // A template is a component iff a rendering exists for it. Index renderings
  // once up front so the templates walk is a pure lookup.
  const renderingComponentNames = roots.renderingsRoot
    ? await collectRenderingComponentNames(roots.renderingsRoot, client)
    : new Set<string>();

  // Walk each distinct templates-tree root exactly once. `componentsRoot` and
  // `contentModelsRoot` are usually distinct paths; `templatesRoot` is the
  // legacy fallback and is only walked when neither bucket root is set (a
  // shared path would otherwise double-emit).
  const walkedPaths = new Set<string>();
  const walkTemplateRoot = async (
    path: string | undefined,
    isComponentsRoot: boolean,
    isContentModelsRoot: boolean
  ): Promise<void> => {
    if (!path || walkedPaths.has(path)) return;
    walkedPaths.add(path);
    recipes.push(
      ...(await walkTemplatesTree(
        path,
        client,
        renderingComponentNames,
        isComponentsRoot,
        isContentModelsRoot
      ))
    );
  };

  await walkTemplateRoot(roots.componentsRoot, true, false);
  await walkTemplateRoot(roots.contentModelsRoot, false, true);
  // Page templates live under their own root (usually a per-site folder
  // the flat templatesRoot walk wouldn't descend into). `walkedPaths`
  // dedups if it happens to coincide with another root.
  await walkTemplateRoot(roots.pageTemplatesRoot, false, false);
  // Only fall back to the flat templatesRoot when no bucket root covered it.
  if (!roots.componentsRoot && !roots.contentModelsRoot) {
    await walkTemplateRoot(roots.templatesRoot, false, false);
  }

  if (roots.enumerationsRoot) {
    recipes.push(...(await walkEnumerationsTree(roots.enumerationsRoot, client)));
  }

  // Layout-bearing kinds (partial-design, page-design, page) reference
  // renderings + datasources by GUID inside their layout XML; placeholder
  // `Allowed Controls` does too. Build the GUID→handle marker index once
  // before reverse-projecting any of them. Content items share the same
  // index for `reference` / `link-internal` resolution. Skip the
  // (potentially large) index walk entirely when no root needs it.
  const needsGuidIndex =
    isSet(roots.partialDesignsRoot) ||
    isSet(roots.pageDesignsRoot) ||
    isSet(roots.pagesRoot) ||
    isSet(roots.placeholderSettingsRoot) ||
    isSet(roots.contentItemsRoot);
  if (needsGuidIndex) {
    const guidIndex = await buildGuidHandleIndex(roots, client);
    if (roots.partialDesignsRoot) {
      recipes.push(...(await walkPartialDesignsTree(roots.partialDesignsRoot, client, guidIndex)));
    }
    if (roots.pageDesignsRoot) {
      recipes.push(...(await walkPageDesignsTree(roots.pageDesignsRoot, client, guidIndex)));
    }
    // Pages and content items both use the per-(lang, version) fan-out;
    // share one tenant-language fetch + one template-shape cache across them.
    // Best-effort tenant-language fetch: the client falls back to `["en"]`
    // when the Authoring schema doesn't expose the query (see
    // `getTenantLanguages` JSDoc).
    const needsMultiLangFetch = isSet(roots.pagesRoot) || isSet(roots.contentItemsRoot);
    const tenantLanguages = needsMultiLangFetch ? await client.getTenantLanguages() : [];
    const templateShapeCache = new Map<string, TemplateFieldShapes>();
    if (roots.pagesRoot) {
      recipes.push(
        ...(await walkPagesTree(
          roots.pagesRoot,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages
        ))
      );
    }
    if (roots.placeholderSettingsRoot) {
      recipes.push(
        ...(await walkPlaceholderSettingsTree(roots.placeholderSettingsRoot, client, guidIndex))
      );
    }
    if (roots.contentItemsRoot) {
      recipes.push(
        ...(await walkContentItemsTree(
          roots.contentItemsRoot,
          client,
          guidIndex,
          templateShapeCache,
          tenantLanguages
        ))
      );
    }
  }

  return recipes;
};

// ───────────────────────────────────────────────────────────────────────────
// Back-compat re-exports — the historic internal surface of this module,
// now split across `read-current/`. Preserved so existing imports
// (`from "./items/read-current"`) keep resolving every symbol.
// ───────────────────────────────────────────────────────────────────────────
export {
  authorableFieldsOf,
  byTreeOrder,
  conformsTo,
  fieldFromItem,
  fieldsOfTemplate,
  fieldValue,
  fieldValueByName,
  finalLayoutXmlOf,
  getTemplateFieldShapes,
  guidEquals,
  handleOf,
  hasSxaComponentBases,
  hasSxaPageBases,
  indexMarkersUnder,
  layoutFromXml,
  layoutOfSnapshot,
  normalizeGuid,
  placementFromParsed,
  sharedLayoutXmlOf,
  shapeFromSitecoreType,
  sitecoreTypeFromLabel,
  type GuidHandleIndex,
  type TemplateFieldInfo,
  type TemplateFieldShapes,
} from "./read-current/helpers";
export {
  collectSharedFields,
  dateOfSnapshot,
  decodeVersionedFieldsOf,
  fetchHistoricSnapshots,
} from "./read-current/content-helpers";
export {
  decodeContentFieldValue,
  decodeExternalLinkXml,
  decodeImageXml,
  decodeInternalLinkXml,
  decodeSitecoreDateToIso,
  decodeTemplatesMapping,
} from "./read-current/decode";
export {
  collectRenderingComponentNames,
  walkEnumerationsTree,
  walkTemplatesTree,
} from "./read-current/project-templates";
export {
  walkPageDesignsTree,
  walkPagesTree,
  walkPartialDesignsTree,
  walkPlaceholderSettingsTree,
} from "./read-current/project-pages";
export { walkContentItemsTree } from "./read-current/project-content";
