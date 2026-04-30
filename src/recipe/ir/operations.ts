import { z } from "zod";

/**
 * Operation IR — the only artifact the recipe compiler emits.
 *
 * Each operation carries a deterministic GUID (resolved via uuidv5 from the
 * recipe handle) so re-running the compiler against the same inputs yields
 * the same IR, and re-applying it against a tenant is a no-op once the
 * items exist (the executor reads remote state by GUID, diffs, then mutates).
 *
 * `policy` is the per-operation push policy: `CreateOnly` is how author
 * edits in the CMS are protected; `CreateAndUpdate` is the default for
 * registry-owned templates and renderings.
 */

const GUID = z.string().uuid();
const NON_EMPTY = z.string().min(1);

export const PushPolicySchema = z.enum(["CreateAndUpdate", "CreateOnly", "CreateUpdateAndDelete"]);

export type PushPolicy = z.infer<typeof PushPolicySchema>;

/**
 * Reference encodings the IR must distinguish — Sitecore stores cross-item
 * references in many shapes (see `plans/sitecore-relationships.md`,
 * "Reference encoding patterns"). The executor decides per-field which form
 * to serialize.
 *
 * Two flavors of GUID reference:
 *
 *   - `ref-guid` / `ref-guid-list` — known-at-compile-time GUIDs (Sitecore
 *     built-ins like the Standard Template, Folder, View Rendering). Inline
 *     constants; no runtime resolution needed.
 *   - `ref-recipe` / `ref-recipe-list` — references to items the executor
 *     creates during this push. The Authoring API server-assigns itemIds
 *     on create, so the IR carries a recipe-internal `refKey` (uuidv5
 *     derived from the recipe handle) and the executor substitutes the
 *     captured Sitecore itemId before dispatching the field write.
 */
export const RefValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), value: z.string() }),
  z.object({ kind: z.literal("bool"), value: z.boolean() }),
  z.object({ kind: z.literal("number"), value: z.number() }),
  z.object({ kind: z.literal("ref-guid"), value: GUID }),
  z.object({ kind: z.literal("ref-guid-list"), values: z.array(GUID) }),
  z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
  z.object({ kind: z.literal("ref-recipe-list"), refKeys: z.array(GUID) }),
  z.object({ kind: z.literal("ref-path"), value: NON_EMPTY }),
  z.object({ kind: z.literal("query"), value: NON_EMPTY }),
  /**
   * Source-convention prefix that references one or more recipe handles
   * (`template:<h>`, `templates:<h1>,<h2>`, `datasource:<q>&template:<h>`).
   * Resolution requires the captured-itemId map; rendered by the executor
   * just before dispatching the field write.
   */
  z.object({ kind: z.literal("ref-source-prefix"), raw: NON_EMPTY }),
  z.object({
    kind: z.literal("url-string-map"),
    entries: z.record(z.string(), z.string()),
  }),
]);

export type RefValue = z.infer<typeof RefValueSchema>;

export const FieldValueSchema = z.object({
  fieldId: GUID,
  /** Omit for shared fields; default `en` for versioned fields. */
  language: z.string().optional(),
  /** Omit for shared fields; default `1` for versioned fields. */
  version: z.number().int().positive().optional(),
  value: RefValueSchema,
});

export type FieldValue = z.infer<typeof FieldValueSchema>;

const BaseOpFields = {
  policy: PushPolicySchema,
  /** Stable, recipe-derived label used in plan/push progress events. */
  label: NON_EMPTY,
} as const;

export const CreateItemOpSchema = z.object({
  op: z.literal("CreateItem"),
  ...BaseOpFields,
  /**
   * Recipe-internal uuidv5. Stable across compiles. Used as the refKey for
   * `ref-recipe` substitutions in subsequent ops. NOT a Sitecore item ID —
   * Sitecore assigns those server-side on `createItem`.
   */
  id: GUID,
  /**
   * Sitecore content-tree path where the item lives (parent + name). The
   * runtime authority for "does this item exist?" — the planner reads
   * by path, the executor creates at this path. Examples:
   *   /sitecore/templates/Project/CtaButton
   *   /sitecore/templates/Project/CtaButton/Content/Link
   */
  path: NON_EMPTY,
  /**
   * Parent ref. `ref-recipe` resolves to the captured Sitecore itemId for
   * a previously-created item in this push; `ref-path` is a Sitecore path
   * (typically the configured templatesRoot for top-level items).
   */
  parent: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
    z.object({ kind: z.literal("ref-path"), value: NON_EMPTY }),
  ]),
  templateOf: GUID,
  name: NON_EMPTY,
  fields: z.array(FieldValueSchema),
});

export const SetFieldOpSchema = z.object({
  op: z.literal("SetField"),
  ...BaseOpFields,
  /** RefKey of the target item — resolves to Sitecore itemId at execute time. */
  itemRefKey: GUID,
  fieldId: GUID,
  language: z.string().optional(),
  version: z.number().int().positive().optional(),
  value: RefValueSchema,
});

export const SetBaseTemplatesOpSchema = z.object({
  op: z.literal("SetBaseTemplates"),
  ...BaseOpFields,
  /** RefKey of the target item. */
  itemRefKey: GUID,
  baseTemplates: z.array(GUID).min(1),
});

export const SetStandardValuesOpSchema = z.object({
  op: z.literal("SetStandardValues"),
  ...BaseOpFields,
  /** RefKey of the template item. */
  templateRefKey: GUID,
  /** RefKey of the standard-values item. */
  standardValuesRefKey: GUID,
});

export const OperationSchema = z.discriminatedUnion("op", [
  CreateItemOpSchema,
  SetFieldOpSchema,
  SetBaseTemplatesOpSchema,
  SetStandardValuesOpSchema,
]);

export type CreateItemOp = z.infer<typeof CreateItemOpSchema>;
export type SetFieldOp = z.infer<typeof SetFieldOpSchema>;
export type SetBaseTemplatesOp = z.infer<typeof SetBaseTemplatesOpSchema>;
export type SetStandardValuesOp = z.infer<typeof SetStandardValuesOpSchema>;
export type Operation = z.infer<typeof OperationSchema>;

export const OperationIrSchema = z.object({
  schemaVersion: z.literal("1"),
  /** Source recipe handle, e.g. `cta-button@1`. */
  recipeHandle: NON_EMPTY,
  operations: z.array(OperationSchema),
});

export type OperationIr = z.infer<typeof OperationIrSchema>;
