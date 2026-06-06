import { consola } from "consola";
import { createScaiError } from "@/shared/errors";
import {
  imageMediaId,
  siteTemplateModuleActionId,
  siteTemplateModuleId,
  templateId,
  thumbnailMediaId,
} from "../items/guids";
import {
  type CreateItemOp,
  type MediaUploadOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_ICON,
  FOUNDATION_SITE_MODULES,
  FOUNDATION_TENANT_MODULES,
  HEADLESS_SITE_SETUP_ROOT,
  SETUP_ACTION_TEMPLATE_PATHS,
  SITECORE_TEMPLATES,
  SITE_TEMPLATE_FIELDS,
  SYSTEM_FIELDS,
  SYSTEM_THUMBNAIL_FIELD_ID,
} from "../ir/sitecore-templates";
import { type SiteTemplateRecipe, SiteTemplateRecipeSchema } from "../schema/recipe";
import { joinPath, sharedField, siteOf, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `SiteTemplateRecipe` to an Operation IR.
 *
 * Emits the SiteTemplate item (a `Solution template`-typed item under
 * `siteTemplatesRoot`) AND, per sub-milestone D
 * (`docs/plans/site-template-modules-and-picker.md`):
 *
 *   - **Picker-tile fields** (G2):
 *     - `__Thumbnail` media-XML — sourced from `recipe.thumbnail`
 *       (discriminated `external-url | asset`); compiles to one
 *       `MediaUploadOp` + one `SetField` op with `media-xml-ref` value.
 *     - `image` is currently dropped (no separate SXA field — A's U3
 *       finding); when sub-milestone E confirms the picker behaviour
 *       this either falls through `__Thumbnail` or gets its own field.
 *     - `Content` (SXA Solution Template) — sourced from
 *       `recipe.contents`; encoded as `JSON.stringify(Array<{name,content}>)`.
 *   - **Module composition** (G1):
 *     - Synthesises ONE tenant-rooted SXA Module item per recipe
 *       (conforming to `HEADLESS_SITE_SETUP_ROOT`) at
 *       `<siteTemplatesRoot>/Modules/<RecipeName>`.
 *     - For each `pageTemplates[i]` / `pageDesigns[i]` /
 *       `insertOptionsMatrix[k]` / `templatesToDesigns[k]` /
 *       `taxonomy[i]` emits a setup-action CHILD under the Module,
 *       conforming to the appropriate setup-action template
 *       (`AddItem`, `EditSiteItem`, `EditTenantTemplate`).
 *     - **Dictionaries are NOT setup-action children.** As of the
 *       2026-06-06 registry mirror, `dictionaries: HandleString[]` is
 *       a REF list; phrases land via the referenced
 *       `DictionaryRecipe`'s own compile path under
 *       `<site>/Dictionary/<recipe.name>/`. Cross-recipe validation
 *       checks every handle resolves.
 *     - Aggregates the 15 Foundation site modules + the synthesised
 *       tenant-rooted Module GUID into `SITE_MODULES` (pipe-separated
 *       deterministic order). Writes the 11 Foundation tenant modules
 *       into `TENANT_MODULES` verbatim (the recipe shape doesn't
 *       describe tenant-scoped overrides).
 *
 * **What's still dropped at install (warned):** `image`. Per A's U3,
 * the SXA Solution template has no separate `image` source field; the
 * Sites API picker likely renders the `__Thumbnail` media at full
 * resolution. The recipe schema still accepts `image` so authors can
 * express intent, but compile drops it pending sub-milestone E's
 * verification — that's the only remaining entry in
 * `DROPPED_AT_INSTALL_FIELDS`.
 *
 * Sandbox introspection (2026-06-06 sub-milestone A) confirmed:
 *   - SXA Module roots conform to `HeadlessSiteSetupRoot`
 *     (`bed31d6f-…`); their children (setup-action items) carry the
 *     brand structure.
 *   - Built-in `Empty Site` carries 15 Foundation SITE_MODULES + 11
 *     TENANT_MODULES; the three production tenant-rooted Solution
 *     templates (Alaris, SYNC, Solterra and Co) mirror that list and
 *     append a single tenant-rooted Module GUID.
 *   - Tenant rooting is supported by the Treelist source's
 *     `/sitecore/system/Settings` scope; picker resolves modules by
 *     template inheritance, not by path.
 */
/**
 * Fields the SiteTemplate Zod schema accepts today but compile still
 * drops at install. After sub-milestone D this list shrinks to just
 * `image` — see the JSDoc above for why.
 */
const DROPPED_AT_INSTALL_FIELDS = [
  "image",
] as const satisfies readonly (keyof SiteTemplateRecipe)[];

function listPopulatedDroppedFields(recipe: SiteTemplateRecipe): string[] {
  return DROPPED_AT_INSTALL_FIELDS.filter((key) => {
    const value: unknown = recipe[key];
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object" && value !== null) return Object.keys(value).length > 0;
    if (typeof value === "string") return value.length > 0;
    return true;
  });
}

/**
 * Sanitize a recipe handle (`my-page@1`) into a Sitecore-valid item
 * name. Sitecore's `ItemNameValidation` setting rejects names containing
 * `@`, `:`, `/`, etc. — the legal class is roughly `^[\w*$][\w\s\-$]*`
 * (verified against the regex error 2026-06-06). The handle's
 * `@<version>` suffix becomes ` v<version>`; other illegal chars
 * collapse to spaces. Empty results fall back to `Item`.
 */
function sanitizeHandleForItemName(handle: string): string {
  const versioned = handle.replace(/@(\d+)$/, " v$1");
  const cleaned = versioned
    .replace(/[^\w\s\-$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "Item";
}

function basenameForMediaSource(
  source: { kind: "external-url"; url: string } | { kind: "asset"; path: string }
): string {
  if (source.kind === "external-url") {
    try {
      const url = new URL(source.url);
      const tail = url.pathname.split("/").filter(Boolean).pop();
      return tail ?? "thumbnail";
    } catch {
      const tail = source.url.split("/").filter(Boolean).pop();
      return tail ?? "thumbnail";
    }
  }
  const tail = source.path.split("/").filter(Boolean).pop();
  return tail ?? "thumbnail";
}

export function compileSiteTemplateRecipe(
  input: SiteTemplateRecipe,
  context: CompileContext
): OperationIr {
  const recipe = SiteTemplateRecipeSchema.parse(input);
  if (!context.siteTemplatesRoot) {
    throw createScaiError(
      `compileSiteTemplateRecipe requires context.siteTemplatesRoot; tenant-side path missing for recipe ${recipe.handle}`,
      "INPUT_INVALID"
    );
  }

  const populatedDropped = listPopulatedDroppedFields(recipe);
  if (populatedDropped.length > 0) {
    consola.warn(
      `compileSiteTemplateRecipe: recipe '${recipe.handle}' populated fields that are accepted by the schema but currently dropped at install (pending docs/plans/site-template-modules-and-picker.md): ${populatedDropped.join(", ")}`
    );
  }

  const operations: Operation[] = [];
  const policy = defaultPolicyForRecipe(recipe.kind);
  const site = siteOf(context);
  const itemRefKey = templateId(site, recipe.handle);
  const itemPath = joinPath(context.siteTemplatesRoot, recipe.name);

  operations.push({
    op: "CreateItem",
    policy,
    label: `site-template:${recipe.handle}`,
    id: itemRefKey,
    path: itemPath,
    parent: { kind: "ref-path", value: context.siteTemplatesRoot },
    templateOf: SITECORE_TEMPLATES.SITE_TEMPLATE,
    name: recipe.name,
    fields: [
      sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: recipe.icon ?? DEFAULT_ICON }),
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // Solution template's own `Name` field — distinct from __Display Name.
  // SXA's Sites UI reads this for the template chooser.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-name:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.NAME,
    value: { kind: "string", value: recipe.displayName },
  } satisfies SetFieldOp);

  if (recipe.description) {
    operations.push({
      op: "SetField",
      policy,
      label: `site-template-description:${recipe.handle}`,
      itemRefKey,
      fieldId: SITE_TEMPLATE_FIELDS.DESCRIPTION,
      value: { kind: "string", value: recipe.description },
    } satisfies SetFieldOp);
  }

  // Available for site creation by default.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-enabled:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.ENABLED,
    value: { kind: "string", value: "1" },
  } satisfies SetFieldOp);

  // "Built-in" is a marker for SXA-shipped templates — recipe-authored
  // ones explicitly mark themselves as not built-in so the Sites UI can
  // distinguish operator-authored brand templates from the canned ones.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-builtin:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE,
    value: { kind: "string", value: "0" },
  } satisfies SetFieldOp);

  // ---------------------------------------------------------------------
  // Picker-tile fields (G2).
  // ---------------------------------------------------------------------

  if (recipe.thumbnail) {
    const refKey = thumbnailMediaId(site, recipe.handle);
    const basename = basenameForMediaSource(recipe.thumbnail);
    operations.push({
      op: "MediaUpload",
      policy,
      label: `media-upload:thumbnail:${recipe.handle}`,
      id: refKey,
      source: recipe.thumbnail,
      destinationPath: `/sitecore/media library/SiteTemplates/${recipe.name}/${basename}`,
      ...(recipe.thumbnail.alt ? { altText: recipe.thumbnail.alt } : {}),
    } satisfies MediaUploadOp);

    operations.push({
      op: "SetField",
      policy,
      label: `site-template-thumbnail:${recipe.handle}`,
      itemRefKey,
      fieldId: SYSTEM_THUMBNAIL_FIELD_ID,
      value: { kind: "media-xml-ref", refKey },
    } satisfies SetFieldOp);
  }

  if (recipe.contents && recipe.contents.length > 0) {
    operations.push({
      op: "SetField",
      policy,
      label: `site-template-contents:${recipe.handle}`,
      itemRefKey,
      fieldId: SITE_TEMPLATE_FIELDS.CONTENT,
      value: { kind: "string", value: JSON.stringify(recipe.contents) },
    } satisfies SetFieldOp);
  }

  // `image` is intentionally NOT compiled today — Sub-milestone A's U3
  // surfaced no separate `image` source field on the SXA Solution template;
  // the picker likely renders the same `__Thumbnail` media at full
  // resolution. The DROPPED_AT_INSTALL_FIELDS warn above fires when
  // authors populate it, so the gap is explicit. The image refKey helper
  // (`imageMediaId`) is in place for sub-milestone E to wire if a separate
  // source field surfaces.
  void imageMediaId;

  // ---------------------------------------------------------------------
  // Module composition (G1) — synthesise the tenant-rooted Module item
  // and its setup-action children, then aggregate SITE_MODULES.
  // ---------------------------------------------------------------------

  const moduleRefKey = siteTemplateModuleId(site, recipe.handle);
  const modulesFolderPath = joinPath(context.siteTemplatesRoot, "Modules");
  const moduleItemPath = joinPath(modulesFolderPath, recipe.name);

  const hasSynthesisInput =
    recipe.pageTemplates.length > 0 ||
    recipe.pageDesigns.length > 0 ||
    (recipe.insertOptionsMatrix && Object.keys(recipe.insertOptionsMatrix).length > 0) ||
    (recipe.templatesToDesigns && Object.keys(recipe.templatesToDesigns).length > 0) ||
    (recipe.taxonomy && recipe.taxonomy.length > 0);

  if (hasSynthesisInput) {
    // Module root. Conforms to HEADLESS_SITE_SETUP_ROOT — the SXA-shipped
    // template every site-scoped Module item conforms to (A's U1 finding).
    operations.push({
      op: "CreateItem",
      policy,
      label: `site-template-module:${recipe.handle}`,
      id: moduleRefKey,
      path: moduleItemPath,
      parent: { kind: "ref-path", value: modulesFolderPath },
      templateOf: HEADLESS_SITE_SETUP_ROOT,
      name: recipe.name,
      fields: [
        sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
          kind: "string",
          value: `${recipe.displayName} Setup`,
        }),
      ],
    } satisfies CreateItemOp);

    // Setup-action children. Each source-recipe field expands into one
    // (or more) child items under the Module root. The action template
    // is picked per source-field kind:
    //
    //   - pageTemplates     → AddItem            (add a page template
    //                                              to the site)
    //   - pageDesigns       → AddItem            (add a page design)
    //   - insertOptionsMatrix → EditSiteItem     (set per-template Insert
    //                                              Options on a site item)
    //   - templatesToDesigns  → EditTenantTemplate (set template→design
    //                                                 mapping at tenant)
    //   - taxonomy          → EditTenantTemplate (seed Taxonomy roots at
    //                                              tenant)
    //
    // Dictionaries are NO LONGER inline on SiteTemplateRecipe — as of
    // the 2026-06-06 registry mirror the template carries
    // `dictionaries: HandleString[]` REFs, and the phrases land via the
    // referenced `DictionaryRecipe`'s own compile path (under
    // `<site>/Dictionary/<recipe.name>/`). The SiteTemplate emits NO
    // setup-action for dictionaries — cross-recipe validation just
    // checks that every handle resolves.
    //
    // **Ambiguous pointer from A** — A's investigation surfaced the action
    // child template NAMES + the production tenant-rooted Module
    // composition pattern, but did NOT capture each action template's
    // GUID. We use the IR's `ref-path` `templateOf` shape (same mechanism
    // workflow templates already use) so the executor resolves these at
    // apply time via a single `getItemsByPaths` batch. Sub-milestone E
    // verifies the path mapping and switches to direct GUIDs if any of
    // the paths diverge on a live tenant.
    const actionPolicy = policy;
    const emitAction = (
      actionKind: string,
      targetHandle: string,
      childName: string,
      templatePath: string
    ): void => {
      const childRefKey = siteTemplateModuleActionId(site, recipe.handle, actionKind, targetHandle);
      operations.push({
        op: "CreateItem",
        policy: actionPolicy,
        label: `site-template-module-action:${recipe.handle}:${actionKind}:${targetHandle}`,
        id: childRefKey,
        path: joinPath(moduleItemPath, childName),
        parent: { kind: "ref-recipe", refKey: moduleRefKey },
        templateOf: { kind: "ref-path", value: templatePath },
        name: childName,
        fields: [
          sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
          versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: childName }),
        ],
      } satisfies CreateItemOp);
    };

    for (const handle of recipe.pageTemplates) {
      emitAction(
        "add-page-template",
        handle,
        `Add ${sanitizeHandleForItemName(handle)}`,
        SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM
      );
    }
    for (const handle of recipe.pageDesigns) {
      emitAction(
        "add-page-design",
        handle,
        `Add ${sanitizeHandleForItemName(handle)}`,
        SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM
      );
    }
    if (recipe.insertOptionsMatrix) {
      for (const parentHandle of Object.keys(recipe.insertOptionsMatrix).sort()) {
        emitAction(
          "insert-options",
          parentHandle,
          `Insert Options ${sanitizeHandleForItemName(parentHandle)}`,
          SETUP_ACTION_TEMPLATE_PATHS.EDIT_SITE_ITEM
        );
      }
    }
    if (recipe.templatesToDesigns) {
      for (const tplHandle of Object.keys(recipe.templatesToDesigns).sort()) {
        emitAction(
          "templates-to-designs",
          tplHandle,
          `Map ${sanitizeHandleForItemName(tplHandle)} to Design`,
          SETUP_ACTION_TEMPLATE_PATHS.EDIT_TENANT_TEMPLATE
        );
      }
    }
    // Dictionaries removed from the setup-action loop (2026-06-06): the
    // phrases live on standalone DictionaryRecipes and land via their
    // own compile path, not as setup-action children of the
    // SiteTemplate's Module item.
    if (recipe.taxonomy) {
      for (const entry of recipe.taxonomy) {
        emitAction(
          "taxonomy",
          entry.root,
          `Taxonomy ${sanitizeHandleForItemName(entry.root)}`,
          SETUP_ACTION_TEMPLATE_PATHS.EDIT_TENANT_TEMPLATE
        );
      }
    }
  }

  // `Site Modules` aggregation. Every recipe-emitted site template carries
  // the 15 Foundation site modules (per A's U2 capture of `Empty Site`)
  // plus the synthesised tenant-rooted Module GUID (when present).
  // Deterministic order — Foundation first, tenant-rooted last — matches
  // the three production tenant-rooted Solution templates' field shape.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-site-modules:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.SITE_MODULES,
    value: hasSynthesisInput
      ? {
          kind: "ref-recipe-list",
          refKeys: [...FOUNDATION_SITE_MODULES, moduleRefKey],
        }
      : {
          kind: "ref-guid-list",
          values: [...FOUNDATION_SITE_MODULES],
        },
  } satisfies SetFieldOp);

  // `Tenant Modules` is the 11 Foundation tenant modules verbatim — no
  // tenant-rooted entry appended because today's SiteTemplateRecipe
  // shape only describes site-scoped brand structure. Cross-site
  // tenant-scoped overrides would need a new authoring surface.
  operations.push({
    op: "SetField",
    policy,
    label: `site-template-tenant-modules:${recipe.handle}`,
    itemRefKey,
    fieldId: SITE_TEMPLATE_FIELDS.TENANT_MODULES,
    value: { kind: "ref-guid-list", values: [...FOUNDATION_TENANT_MODULES] },
  } satisfies SetFieldOp);

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}
