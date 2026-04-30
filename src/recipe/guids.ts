import { v5 as uuidv5 } from "uuid";

/**
 * Deterministic GUID derivation for recipe-emitted Sitecore items.
 *
 * Every item GUID is a uuidv5 hash of (a kind-namespace, a stable seed).
 * Same recipe inputs produce the same GUIDs forever — that's how recipe
 * pushes are idempotent without server-side state.
 *
 * The namespacing tree is:
 *
 *   DNS                      RFC 4122 DNS namespace
 *     └── NAMESPACE_ROOT     uuidv5(DNS, "registry.sitecoreai.dev")
 *           ├── TEMPLATE     uuidv5(ROOT, "template")
 *           ├── RENDERING    uuidv5(ROOT, "rendering")
 *           ├── PAGE_DESIGN  uuidv5(ROOT, "page-design")
 *           └── SITE_BRANCH  uuidv5(ROOT, "site-branch")
 *
 * The `handle` of a recipe (e.g. `cta-button@1`) is load-bearing forever:
 * a different handle = a different template. Versioning is pinned;
 * `cta-button@1` → `cta-button@2` is a *new* template.
 */

/** RFC 4122 DNS namespace. */
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Frozen at v1. Hardcoded literal so repo edits to derivation logic can't
 * silently re-namespace existing tenants. The `__namespace_root_is_frozen`
 * test asserts this matches `uuidv5(DNS, "registry.sitecoreai.dev")`.
 */
export const NAMESPACE_ROOT = "d6c28e9f-21f3-56ee-ada3-f2a947c3d475";

export const NAMESPACE_TEMPLATE = uuidv5("template", NAMESPACE_ROOT);
export const NAMESPACE_RENDERING = uuidv5("rendering", NAMESPACE_ROOT);
export const NAMESPACE_PAGE_DESIGN = uuidv5("page-design", NAMESPACE_ROOT);
export const NAMESPACE_SITE_BRANCH = uuidv5("site-branch", NAMESPACE_ROOT);

/** Internal: lets the test prove `NAMESPACE_ROOT` matches its derivation. */
export const _deriveNamespaceRoot = (): string => uuidv5("registry.sitecoreai.dev", DNS_NAMESPACE);

export const templateId = (handle: string): string => uuidv5(handle, NAMESPACE_TEMPLATE);

export const renderingId = (handle: string): string => uuidv5(handle, NAMESPACE_RENDERING);

export const paramsTemplateId = (handle: string): string =>
  uuidv5(`${handle}::params`, NAMESPACE_TEMPLATE);

export const pageDesignId = (handle: string): string => uuidv5(handle, NAMESPACE_PAGE_DESIGN);

export const siteBranchId = (handle: string): string => uuidv5(handle, NAMESPACE_SITE_BRANCH);

/** Sections are scoped under their template; the seed is `section:<name>`. */
export const sectionId = (handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, templateId(handle));

/** Fields are scoped under their template; the seed is the field name. */
export const fieldId = (handle: string, fieldName: string): string =>
  uuidv5(fieldName, templateId(handle));

/** Sections of the parameters template scope under `paramsTemplateId`. */
export const paramsSectionId = (handle: string, sectionName: string): string =>
  uuidv5(`section:${sectionName}`, paramsTemplateId(handle));

/** Fields of the parameters template scope under `paramsTemplateId`. */
export const paramsFieldId = (handle: string, fieldName: string): string =>
  uuidv5(fieldName, paramsTemplateId(handle));

/** Variants folder lives under the rendering item: <Rendering>/Variants. */
export const variantsFolderId = (handle: string): string =>
  uuidv5("__variants", renderingId(handle));

/** Each Variant item lives under the Variants folder. */
export const variantId = (handle: string, variantName: string): string =>
  uuidv5(variantName, variantsFolderId(handle));

/**
 * Standard values is a child of the template whose template-of is the
 * template's own ID. The GUID is derived from the template ID with the
 * `__standard-values` seed.
 */
export const standardValuesId = (handle: string): string =>
  uuidv5("__standard-values", templateId(handle));

/**
 * Datasource items are scoped to a page recipe's id, keyed on slot path —
 * redeploys with regenerated mock content overwrite the same item.
 * Phase 1 doesn't emit these; defined here for forward-compat parity with
 * the planning doc.
 */
export const datasourceId = (pageItemId: string, slotPath: string): string =>
  uuidv5(slotPath, pageItemId);
