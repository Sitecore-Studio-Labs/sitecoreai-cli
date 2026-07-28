import {
  componentFoldersBucketId,
  contentModelsGroupFolderId,
  enumerationsGroupingFolderId,
  pageTemplatesGroupFolderId,
  presentationDesignParametersBucketId,
  renderingsSectionFolderId,
  sectionFolderId,
} from "../items/guids";
import { type CreateItemOp, type Operation } from "../ir/operations";
import { FOLDER_ICON, SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { createScaiError } from "@/shared/errors";
import {
  COMPONENT_FOLDERS_BUCKET,
  type CompileContext,
  joinPath,
  PRESENTATION_PARAMETERS_BUCKET,
  resolveComponentTemplateParent,
  sharedField,
  siteOf,
} from "./shared";

/**
 * Ensure a section folder (under `componentsRoot/<section>`) exists.
 * Idempotent: emits a CreateOnly CreateItem op the first time a given
 * (site, section) pair is seen and records the refKey in the
 * `emittedFolders` set so subsequent calls are no-ops.
 *
 * Returns the section folder's refKey for downstream callers that want
 * to nest items under it.
 */
export const ensureSectionFolder = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = sectionFolderId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);

  const parent = context.componentsRoot ?? context.templatesRoot;
  const path = joinPath(parent, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `section-folder:${site}:${section}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: parent },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: section,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Component Folders" subfolder exists under the section
 * folder. Idempotent.
 */
export const ensureComponentFoldersBucket = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = componentFoldersBucketId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const sectionRefKey = ensureSectionFolder(operations, context, section, emittedFolders);
  const parentPath = resolveComponentTemplateParent(context, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `component-folders-bucket:${site}:${section}`,
    id: refKey,
    path: joinPath(parentPath, COMPONENT_FOLDERS_BUCKET),
    parent: { kind: "ref-recipe", refKey: sectionRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: COMPONENT_FOLDERS_BUCKET,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a "Presentation Parameters" subfolder exists under the section
 * folder. Idempotent.
 */
export const ensurePresentationDesignParametersBucket = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = presentationDesignParametersBucketId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const sectionRefKey = ensureSectionFolder(operations, context, section, emittedFolders);
  const parentPath = resolveComponentTemplateParent(context, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `presentation-parameters-bucket:${site}:${section}`,
    id: refKey,
    path: joinPath(parentPath, PRESENTATION_PARAMETERS_BUCKET),
    parent: { kind: "ref-recipe", refKey: sectionRefKey },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: PRESENTATION_PARAMETERS_BUCKET,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a section subfolder under the renderings tree exists —
 * `<renderingsRoot>/<section>/`. Mirrors the templates side; the
 * rendering tree shape mirrors the template tree per the layout plan.
 */
export const ensureRenderingsSectionFolder = (
  operations: Operation[],
  context: CompileContext,
  section: string,
  emittedFolders: Set<string>
): string => {
  const site = siteOf(context);
  const refKey = renderingsSectionFolderId(site, section);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const path = joinPath(context.renderingsRoot, section);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `renderings-section-folder:${site}:${section}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: context.renderingsRoot },
    // Real SXA renderings-tree section folders use `Rendering Folder`,
    // not the generic `Folder` template. Verified against live tenant
    // 2026-05-02 — every section under
    // `/sitecore/layout/Renderings/Project/<site>/` conforms to this.
    templateOf: SITECORE_TEMPLATES.RENDERING_FOLDER,
    name: section,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a Content Models group folder exists. Returns the refKey for
 * downstream `CreateItem.parent` references. Idempotent across
 * repeated calls within one recipe-set compile.
 */
export const ensureContentModelsGroupFolder = (
  operations: Operation[],
  context: CompileContext,
  group: string,
  emittedFolders: Set<string>
): string | undefined => {
  if (!context.contentModelsRoot) return undefined;
  const site = siteOf(context);
  const refKey = contentModelsGroupFolderId(site, group);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  const path = joinPath(context.contentModelsRoot, group);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `content-models-group-folder:${site}:${group}`,
    id: refKey,
    path,
    parent: { kind: "ref-path", value: context.contentModelsRoot },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: group,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure a page-templates group folder exists under `<root>/<group>`,
 * where `<root>` is `pageTemplatesRoot` (falling back to `templatesRoot`).
 * Returns the refKey for `CreateItem.parent`, or `undefined` when no
 * root resolves. Idempotent across one recipe-set compile via
 * `emittedFolders`. Mirror of `ensureContentModelsGroupFolder` for the
 * page-template tree.
 */
export const ensurePageTemplatesGroupFolder = (
  operations: Operation[],
  context: CompileContext,
  group: string,
  emittedFolders: Set<string>
): string | undefined => {
  const root = context.pageTemplatesRoot ?? context.templatesRoot;
  if (!root) return undefined;
  const site = siteOf(context);
  const refKey = pageTemplatesGroupFolderId(site, group);
  if (emittedFolders.has(refKey)) return refKey;
  emittedFolders.add(refKey);
  operations.push({
    op: "CreateItem",
    policy: "CreateOnly",
    label: `page-templates-group-folder:${site}:${group}`,
    id: refKey,
    path: joinPath(root, group),
    parent: { kind: "ref-path", value: root },
    templateOf: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
    name: group,
    fields: [sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: FOLDER_ICON })],
  } satisfies CreateItemOp);
  return refKey;
};

/**
 * Ensure the grouping-folder chain for an enumeration's `location.folder`
 * exists under `<enumerationsRoot>`, and return the leaf's
 * `{ parentPath, parentRef }` so the per-enum container nests under it.
 *
 * Multi-segment paths (`"Theme/Color"` → `["Theme", "Color"]`) emit ONE
 * `CreateItem` per cumulative segment, each conforming to the per-site
 * `Enumerations Folder` template (`folderTemplateRefKey`) — an explicit
 * emit per segment is required so the executor's path-walker doesn't
 * auto-create intermediates as the generic `Folder` template (which lacks
 * the Enumerations Folder Standard Values, breaking the author Insert
 * Options chain). Each segment is keyed on its CUMULATIVE path via
 * `enumerationsGroupingFolderId`, so recipes sharing a prefix reuse the
 * same items; `emittedFolders` dedups within one compile.
 *
 * When a segment's refKey is already in `emittedFolders` (e.g. pre-seeded
 * by the `__shared-folders__` aggregate, or emitted by an earlier recipe)
 * the `CreateItem` is skipped but the parent chain is still walked, so the
 * returned leaf ref is correct regardless.
 */
export const ensureEnumerationGroupingFolders = (
  operations: Operation[],
  context: CompileContext,
  folderSegments: readonly string[] | undefined,
  folderTemplateRefKey: string,
  emittedFolders: Set<string>
): { parentPath: string; parentRef: CreateItemOp["parent"] } => {
  const site = siteOf(context);
  const root = context.enumerationsRoot;
  if (!root) {
    throw createScaiError(
      "ensureEnumerationGroupingFolders requires enumerationsRoot on the compile context.",
      "INPUT_INVALID"
    );
  }
  let parentPath = root;
  let parentRef: CreateItemOp["parent"] = { kind: "ref-path", value: root };
  if (!folderSegments || folderSegments.length === 0) return { parentPath, parentRef };

  const cumulativeSegments: string[] = [];
  for (const segment of folderSegments) {
    cumulativeSegments.push(segment);
    const cumulativePath = cumulativeSegments.join("/");
    const segmentRefKey = enumerationsGroupingFolderId(site, cumulativePath);
    const segmentPath = joinPath(root, cumulativePath);
    if (!emittedFolders.has(segmentRefKey)) {
      emittedFolders.add(segmentRefKey);
      operations.push({
        op: "CreateItem",
        policy: "CreateOnly",
        label: `enumerations-grouping-folder:${site}:${cumulativePath}`,
        id: segmentRefKey,
        path: segmentPath,
        parent: parentRef,
        templateOf: folderTemplateRefKey,
        name: segment,
        fields: [],
      } satisfies CreateItemOp);
    }
    parentPath = segmentPath;
    parentRef = { kind: "ref-recipe", refKey: segmentRefKey };
  }
  return { parentPath, parentRef };
};
