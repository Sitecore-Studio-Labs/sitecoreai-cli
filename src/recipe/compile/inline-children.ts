import { datasourceId, fieldId, templateId } from "../items/guids";
import type { CreateItemOp, PushPolicy, RefValue, SetFieldOp } from "../ir/operations";
import {
  DEFAULT_ICON,
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import type { ContentFieldValue, FieldDefinition } from "../schema/recipe";
import { encodeContentFieldValue } from "./content-item";
import {
  type CompileContext,
  type ImageMediaSink,
  joinPath,
  sharedField,
  versionedField,
} from "./shared";

/**
 * Inline treelist child materialisation.
 *
 * AI-generated page recipes commonly carry a component datasource whose
 * field value is an inline ARRAY of child-item field maps — a card
 * grid's cards, ranking rows, versus rows:
 *
 * ```jsonc
 * datasourceRef: {
 *   kind: "scoped",
 *   slot: "CardGrid",
 *   fields: {
 *     Heading: "Top players",
 *     Cards: [
 *       { Title: "Card one", Image: { src: "https://…" } },
 *       { Title: "Card two" },
 *     ],
 *   },
 * }
 * ```
 *
 * Sitecore has no "array" field — the canonical shape is a Treelist
 * (multi-reference) field whose value is a pipe-separated GUID list
 * pointing at REAL child items under the datasource item. This module
 * turns an inline array into exactly that:
 *
 *   1. One `CreateItem` per entry under the datasource item
 *      (`<parent>/<fieldName>-<n>`), conforming to the treelist field's
 *      child template — resolved from the field definition's
 *      `sitecore.source.types[0]` (the picker filter that names the
 *      compatible child recipe handles).
 *   2. One `SetField` per child field value, flowing through the same
 *      `normalizeFieldValue` → `encodeContentFieldValue` pipeline as
 *      every other content value — so child image fields ride the same
 *      MediaUpload ingest path (via the caller's `ImageMediaSink`).
 *   3. The parent field's value becomes a `ref-recipe-list` of the
 *      children's refKeys — the executor resolves it to the
 *      `{GUID}|{GUID}` Treelist wire form after the child creates land.
 *
 * Nested arrays inside a child entry recurse (grandchildren live under
 * their own parent child item), resolving each level's child template
 * against that level's template fields.
 *
 * When the child template CANNOT be resolved (the field definition
 * isn't visible to the compile, or it declares no `source.types`), the
 * materialiser returns `null` and the caller falls back to the legacy
 * behaviour (the array value is dropped from emission).
 */

export interface InlineChildMaterialization {
  /**
   * CreateItem ops for the child items, parent-before-child order.
   * Callers must place these BEFORE the field ops in the final IR so
   * the executor captures each child's itemId before the parent
   * treelist `ref-recipe-list` resolves.
   */
  createOps: CreateItemOp[];
  /** SetField ops for the children's own field values. */
  fieldOps: SetFieldOp[];
  /**
   * The parent field's value — the children's refKeys, resolved by the
   * executor to a pipe-separated GUID list (Treelist wire form).
   */
  parentValue: RefValue;
}

/**
 * True when a raw field value is an inline child-item array: a
 * non-empty array whose every entry is a plain field-map object.
 * Entries carrying a value-level discriminator (`shape` — scai-native
 * ContentFieldValue; `src` — registry image; `href` — registry link)
 * are field VALUES, not field maps, so such arrays are not treated as
 * child items.
 */
export const isInlineChildArray = (raw: unknown): raw is Record<string, unknown>[] =>
  Array.isArray(raw) &&
  raw.length > 0 &&
  raw.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      !("shape" in entry) &&
      !("src" in entry) &&
      !("href" in entry)
  );

/**
 * Normalise a raw field value (registry flat shape OR scai-native
 * discriminated shape) to a `ContentFieldValue` for
 * `encodeContentFieldValue`. Returns `null` when the value is not
 * recognised (drops it from emission).
 *
 * Registry shape mapping:
 *  - string  → `{ shape: "text" }`
 *  - boolean → `{ shape: "boolean" }`
 *  - number  → `{ shape: "integer" }` when an integer, else `{ shape: "number" }`
 *  - object with `src`  → `{ shape: "image", mediaPath: src, alt?, width?, height? }`
 *  - object with `href` → `{ shape: "link-external", href, text?, target?, title? }`
 *  - object with `shape` → already a `ContentFieldValue`, pass through
 *
 * Lives here (not in `./page`) so the scoped-datasource materialiser
 * and the inline-children recursion can import it without a
 * page-compiler dependency cycle; `./page` re-exports it for
 * back-compat.
 */
export const normalizeFieldValue = (raw: unknown): ContentFieldValue | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return { shape: "text", value: raw };
  if (typeof raw === "boolean") return { shape: "boolean", value: raw };
  if (typeof raw === "number") {
    return Number.isInteger(raw)
      ? { shape: "integer", value: raw }
      : { shape: "number", value: raw };
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Already a scai-native discriminated ContentFieldValue.
    if (typeof obj.shape === "string") return obj as unknown as ContentFieldValue;
    // Registry image shape: { src, alt?, width?, height?, mediaLibraryFolder? }.
    if (typeof obj.src === "string") {
      return {
        shape: "image",
        mediaPath: obj.src,
        ...(typeof obj.alt === "string" ? { alt: obj.alt } : {}),
        ...(typeof obj.width === "number" ? { width: obj.width } : {}),
        ...(typeof obj.height === "number" ? { height: obj.height } : {}),
        ...(typeof obj.mediaLibraryFolder === "string"
          ? { mediaLibraryFolder: obj.mediaLibraryFolder }
          : {}),
      };
    }
    // Registry external-link shape: { href, text?, target?, title? }.
    if (typeof obj.href === "string") {
      return {
        shape: "link-external",
        href: obj.href,
        ...(typeof obj.text === "string" ? { text: obj.text } : {}),
        ...(typeof obj.target === "string" ? { target: obj.target } : {}),
        ...(typeof obj.title === "string" ? { title: obj.title } : {}),
      };
    }
  }
  return null;
};

/**
 * Find the definition of `fieldName` on the template identified by
 * `templateHandle` — checking component templates (inline-`fields:`
 * datasource pattern) first, then content templates (external
 * datasource-template pattern). Exact-name match, mirroring the
 * executor's field-name resolution.
 */
const fieldDefinitionFor = (
  context: CompileContext,
  templateHandle: string,
  fieldName: string
): FieldDefinition | undefined => {
  const fromComponent = context.componentsByHandle
    ?.get(templateHandle)
    ?.fields.find((f) => f.name === fieldName);
  if (fromComponent) return fromComponent;
  return context.contentTemplatesByHandle
    ?.get(templateHandle)
    ?.fields.find((f) => f.name === fieldName);
};

/**
 * The child template handle an inline array's items conform to — the
 * FIRST entry of the field's `sitecore.source.types` picker filter
 * (mirrors `datasource.templates[0]` precedence elsewhere: the first
 * listed template is the primary shape). `undefined` when the field
 * definition isn't visible or declares no filter types — the caller
 * then keeps the legacy drop behaviour.
 */
const childTemplateHandleFor = (
  context: CompileContext,
  templateHandle: string,
  fieldName: string
): string | undefined => {
  const source = fieldDefinitionFor(context, templateHandle, fieldName)?.sitecore?.source;
  if (source?.kind === "filter" && source.types && source.types.length > 0) {
    return source.types[0];
  }
  return undefined;
};

/**
 * Sitecore-safe item name. Sitecore's default `InvalidItemNameChars`
 * rejects `\/:?"<>|[]` and names can't be empty — strip anything
 * outside the conservative safe set and collapse whitespace.
 */
const sanitizeItemName = (name: string): string => {
  const cleaned = name
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "item";
};

export interface MaterializeInlineChildrenParams {
  /** The inline array — pre-checked via `isInlineChildArray`. */
  entries: readonly Record<string, unknown>[];
  /** Name of the treelist/multilist field carrying the array. */
  fieldName: string;
  /** RefKey of the item that owns the field (the datasource item). */
  parentItemRefKey: string;
  /** Tenant path of that item — children land at `<path>/<name>`. */
  parentItemPath: string;
  /** Handle of the template the parent item conforms to. */
  parentTemplateHandle: string;
  recipeHandle: string;
  site: string;
  policy: PushPolicy;
  context: CompileContext;
  /** Op-label prefix, e.g. `page-inline:<recipe>` — labels get `:<field>:<n>` suffixes. */
  labelPrefix: string;
  /**
   * Media sink for child image fields — external-URL images then ride
   * the same MediaUpload ingest path as every other image value. Omit
   * (design compilers) for the legacy hotlink form.
   */
  imageMedia?: ImageMediaSink;
}

/**
 * Materialise an inline child-item array — see the module docblock.
 * Returns `null` when the child template can't be resolved; the caller
 * then keeps the legacy behaviour for the raw value.
 */
export const materializeInlineChildren = (
  params: MaterializeInlineChildrenParams
): InlineChildMaterialization | null => {
  const { context, fieldName, parentTemplateHandle } = params;
  const childHandle = childTemplateHandleFor(context, parentTemplateHandle, fieldName);
  if (childHandle === undefined) return null;

  const createOps: CreateItemOp[] = [];
  const fieldOps: SetFieldOp[] = [];
  const childRefKeys: string[] = [];
  const site = params.site;

  params.entries.forEach((entry, index) => {
    // Index-stable identity: refKey and item name derive from
    // (field, position), never from entry content — retitling a card on
    // re-push keeps the same Sitecore item instead of minting a
    // duplicate sibling.
    const childRefKey = datasourceId(params.parentItemRefKey, `${fieldName}[${index}]`);
    const childName = sanitizeItemName(`${fieldName}-${index + 1}`);
    const childPath = joinPath(params.parentItemPath, childName);
    childRefKeys.push(childRefKey);

    createOps.push({
      op: "CreateItem",
      policy: params.policy,
      label: `${params.labelPrefix}:${fieldName}:${index + 1}`,
      id: childRefKey,
      path: childPath,
      parent: { kind: "ref-recipe", refKey: params.parentItemRefKey },
      templateOf: templateId(site, childHandle),
      name: childName,
      fields: [
        sharedField(SYSTEM_FIELDS.ICON, { kind: "string", value: DEFAULT_ICON }),
        versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: childName }),
      ],
    } satisfies CreateItemOp);

    for (const [childFieldName, childRaw] of Object.entries(entry)) {
      // Grandchildren: a child entry's own inline array recurses with
      // the child template as the field-definition scope.
      if (isInlineChildArray(childRaw)) {
        const nested = materializeInlineChildren({
          ...params,
          entries: childRaw,
          fieldName: childFieldName,
          parentItemRefKey: childRefKey,
          parentItemPath: childPath,
          parentTemplateHandle: childHandle,
        });
        if (nested === null) continue; // unresolvable → legacy drop
        createOps.push(...nested.createOps);
        fieldOps.push(...nested.fieldOps);
        fieldOps.push(
          childSetField(
            params,
            { childRefKey, childHandle, childFieldName, index },
            nested.parentValue
          )
        );
        continue;
      }
      const normalised = normalizeFieldValue(childRaw);
      if (normalised === null) continue;
      const value = encodeContentFieldValue(
        normalised,
        params.recipeHandle,
        site,
        params.imageMedia ? { fieldName: childFieldName, ...params.imageMedia } : undefined
      );
      fieldOps.push(
        childSetField(params, { childRefKey, childHandle, childFieldName, index }, value)
      );
    }
  });

  return {
    createOps,
    fieldOps,
    parentValue: { kind: "ref-recipe-list", refKeys: childRefKeys },
  };
};

/** Identity of one child field write — see `childSetField`. */
interface ChildFieldTarget {
  childRefKey: string;
  childHandle: string;
  childFieldName: string;
  index: number;
}

/** One SetField on a child item, versioned at the primary language. */
const childSetField = (
  params: MaterializeInlineChildrenParams,
  target: ChildFieldTarget,
  value: RefValue
): SetFieldOp => ({
  op: "SetField",
  policy: params.policy,
  label: `${params.labelPrefix}:${params.fieldName}:${target.index + 1}:${target.childFieldName}`,
  itemRefKey: target.childRefKey,
  // Recipe-created field — Sitecore assigns its own GUID, so this is an
  // IR-internal refKey; the mutation resolves via `fieldName`.
  fieldId: fieldId(params.site, target.childHandle, target.childFieldName),
  fieldName: target.childFieldName,
  language: DEFAULT_LANGUAGE,
  version: DEFAULT_VERSION,
  value,
});
